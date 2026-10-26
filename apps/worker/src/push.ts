/**
 * Notificações no celular (Web Push, padrão aberto do navegador; sem serviço pago).
 *  - Chaves VAPID (P-256) geradas automaticamente na primeira vez e guardadas no banco: nada para configurar.
 *  - Mensagem cifrada conforme RFC 8291 (aes128gcm) e assinada com VAPID (RFC 8292, JWT ES256).
 *  - Alertas: só quando algo muda (bomba passou do tempo, falha ao desligar, sensor sem sinal, fora da faixa,
 *    horário pulado). Repete no máximo a cada 2 h enquanto o problema continuar.
 */
import type { D1Database } from '@cloudflare/workers-types';
import { buildSnapshot, evaluateAlerts, localDateTimeString } from '@orq/core';
import type { AppConfig } from '@orq/core';
import { automationStatusDto } from './automation';
import type { Env } from './env';
import { HttpError } from './http';
import { PROVIDER } from './ewelink';
import { pumpStatusOf, recentIrrigations } from './irrigation';
import { logError } from './logging';
import { getSetting, latestReadings, listProviderDevices, putSetting } from './repo';

const enc = new TextEncoder();
const b64u = (b: ArrayBuffer | Uint8Array) => {
  const u = b instanceof Uint8Array ? b : new Uint8Array(b);
  let s = '';
  for (const x of u) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
export const fromB64u = (s: string) => {
  const t = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  return Uint8Array.from(t, (c) => c.charCodeAt(0));
};
const concat = (...a: Uint8Array[]) => {
  const out = new Uint8Array(a.reduce((n, x) => n + x.length, 0));
  let o = 0;
  for (const x of a) {
    out.set(x, o);
    o += x.length;
  }
  return out;
};

async function hmac(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, data));
}
/** HKDF (extract + 1 bloco de expand), suficiente para até 32 bytes. */
async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, len: number): Promise<Uint8Array> {
  const prk = await hmac(salt, ikm);
  return (await hmac(prk, concat(info, new Uint8Array([1])))).slice(0, len);
}

interface Vapid {
  publicKey: string; // raw (65 bytes) em base64url
  privateJwk: JsonWebKey;
}
const VAPID_KEY = 'push_vapid';

export async function getVapid(db: D1Database, now: number): Promise<Vapid> {
  const saved = await getSetting<Vapid>(db, VAPID_KEY);
  if (saved) return saved;
  const kp = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  const v: Vapid = { publicKey: b64u((await crypto.subtle.exportKey('raw', kp.publicKey)) as ArrayBuffer), privateJwk: (await crypto.subtle.exportKey('jwk', kp.privateKey)) as JsonWebKey };
  await putSetting(db, VAPID_KEY, v, now);
  return v;
}

export interface PushSub {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** Cifra a mensagem para uma assinatura (RFC 8291, aes128gcm). Exportada para teste. */
export async function encryptPayload(sub: PushSub, payload: string): Promise<Uint8Array> {
  const uaPublic = fromB64u(sub.p256dh);
  const authSecret = fromB64u(sub.auth);
  const local = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair;
  const asPublic = new Uint8Array((await crypto.subtle.exportKey('raw', local.publicKey)) as ArrayBuffer);
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey } as unknown as Parameters<typeof crypto.subtle.deriveBits>[0], local.privateKey, 256));
  const ikm = await hkdf(authSecret, ecdh, concat(enc.encode('WebPush: info\0'), uaPublic, asPublic), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, concat(enc.encode(payload), new Uint8Array([2]))));
  const header = new Uint8Array(21);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = 65;
  return concat(header, asPublic, cipher);
}

async function vapidAuth(v: Vapid, endpoint: string, now: number): Promise<string> {
  const aud = new URL(endpoint).origin;
  const h = b64u(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const c = b64u(enc.encode(JSON.stringify({ aud, exp: Math.floor(now / 1000) + 12 * 3600, sub: 'mailto:orquidario@example.com' })));
  const key = await crypto.subtle.importKey('jwk', v.privateJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(`${h}.${c}`));
  return `vapid t=${h}.${c}.${b64u(sig)}, k=${v.publicKey}`;
}

/** Envia para uma assinatura. Retorna false se a assinatura não existe mais (deve ser apagada). */
async function sendOne(v: Vapid, sub: PushSub, msg: { title: string; body: string; tag: string }, now: number): Promise<boolean> {
  const body = await encryptPayload(sub, JSON.stringify(msg));
  const res = await fetch(sub.endpoint, {
    method: 'POST',
    headers: { Authorization: await vapidAuth(v, sub.endpoint, now), 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: '3600', Urgency: 'high' },
    body,
    signal: AbortSignal.timeout(10_000),
  });
  if (res.status === 404 || res.status === 410) return false;
  if (!res.ok) throw new Error(`push ${res.status}`);
  return true;
}

export async function saveSubscription(db: D1Database, sub: PushSub, now: number): Promise<void> {
  if (!/^https:\/\//.test(sub.endpoint) || sub.endpoint.length > 1000 || !sub.p256dh || !sub.auth) throw new HttpError(400, 'invalid_subscription', 'Assinatura inválida.');
  await db
    .prepare('INSERT INTO push_subscriptions (endpoint, p256dh, auth, created_at) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth')
    .bind(sub.endpoint, sub.p256dh, sub.auth, now)
    .run();
}

export async function deleteSubscription(db: D1Database, endpoint: string): Promise<void> {
  await db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?1').bind(endpoint).run();
}

export async function sendToAll(db: D1Database, env: Env, msg: { title: string; body: string; tag: string }, now: number, only?: string): Promise<number> {
  const v = await getVapid(db, now);
  const r = only
    ? await db.prepare('SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE endpoint = ?1').bind(only).all<PushSub>()
    : await db.prepare('SELECT endpoint, p256dh, auth FROM push_subscriptions').all<PushSub>();
  let sent = 0;
  for (const sub of r.results ?? []) {
    try {
      if (await sendOne(v, sub, msg, now)) sent++;
      else await deleteSubscription(db, sub.endpoint);
    } catch (e) {
      logError('push', e, env);
    }
  }
  return sent;
}

/* ------------------------------------------- alertas automáticos ------------------------------------------- */

const STATE_KEY = 'push_alerts';
const REPEAT_MS = 2 * 3600_000;

/** Verifica as condições de alerta e avisa só nas mudanças (e de novo a cada 2 h se continuar). */
export async function runPushAlerts(env: Env, db: D1Database, config: AppConfig, now: number): Promise<void> {
  const subs = await db.prepare('SELECT COUNT(*) AS n FROM push_subscriptions').first<{ n: number }>();
  if (!subs?.n) return;
  const active: Record<string, { title: string; body: string }> = {};

  const snap = buildSnapshot(config, await latestReadings(db, config.sensors.map((s) => s.id)), now);
  for (const s of snap.sensors) {
    if (!s.valid && s.ageMs !== null && config.sensors.find((x) => x.id === s.sensor.id)?.externalId) {
      active[`sem_sinal:${s.sensor.id}`] = { title: `${s.sensor.name} sem sinal`, body: `Sem leitura há ${Math.round(s.ageMs / 60_000)} min. Confira o hub e as pilhas.` };
    }
  }
  for (const h of evaluateAlerts(snap, config.alerts)) {
    const what = h.kind === 'temperature' ? (h.direction === 'above' ? 'Estufa quente' : 'Estufa fria') : h.kind === 'humidity' ? (h.direction === 'above' ? 'Umidade muito alta' : 'Ar seco') : 'DPV fora da faixa';
    const name = config.sensors.find((x) => x.id === h.sensorId)?.name ?? h.sensorId;
    active[`faixa:${h.kind}:${h.direction}`] = { title: what, body: `${name}: ${h.value.toFixed(1)} (limite ${h.limit}).` };
  }
  if (config.pump.deviceId) {
    const device = (await listProviderDevices(db, PROVIDER)).find((d) => d.deviceId === config.pump.deviceId);
    const pump = pumpStatusOf(config, device, now);
    const last = (await recentIrrigations(db, 1))[0];
    if (pump.state === 'on' && last && last.endedAt === null) {
      const min = Math.round((now - Date.parse(last.startedAt)) / 60_000);
      if (min > config.pump.maxRunMin + 2) active.bomba_tempo = { title: 'Bomba ligada há muito tempo', body: `Ligada há ${min} min (previsto ${config.pump.maxRunMin} min). Risco de esvaziar a caixa d'água.` };
    }
    const auto = await automationStatusDto(env, db, config, now);
    if (pump.state === 'on' && auto.lastCommand?.action === 'off' && !auto.lastCommand.ok) {
      active.bomba_falha = { title: 'Não consegui desligar a bomba', body: `${auto.lastCommand.reason}. Confira a bomba no local.` };
    }
    const today = localDateTimeString(now).slice(0, 10);
    for (const s of auto.slots) if (s.status === 'pulado') active[`pulado:${today}:${s.time}`] = { title: `Irrigação das ${s.time} pulada`, body: s.detail ?? '' };
  }

  const state = (await getSetting<Record<string, number>>(db, STATE_KEY)) ?? {};
  const next: Record<string, number> = {};
  for (const [k, msg] of Object.entries(active)) {
    const sentAt = state[k];
    if (sentAt === undefined || now - sentAt >= REPEAT_MS) {
      await sendToAll(db, env, { ...msg, tag: k }, now);
      next[k] = now;
    } else next[k] = sentAt;
  }
  // horários pulados ficam lembrados até o fim do dia (não repetem)
  for (const [k, t] of Object.entries(state)) if (k.startsWith('pulado:') && !(k in next) && now - t < 24 * 3600_000) next[k] = t;
  await putSetting(db, STATE_KEY, next, now);
}
