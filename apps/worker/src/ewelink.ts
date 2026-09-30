/**
 * Integração eWeLink (API v2 oficial, OAuth 2.0 para desenvolvedor pessoal).
 *
 * Baseado na documentação oficial (github.com/CoolKit-Technologies/eWeLink-API, en/OAuth2.0.md, en/APICenterV2.md,
 * en/UIIDProtocol.md), consultada em 30/09/2026:
 *  - Página de login: https://c2ccdn.coolkit.cc/oauth/index.html com clientId, seq, authorization = Base64(HMAC-SHA256(
 *    appSecret, `${clientId}_${seq}`)), redirectUrl, state, nonce (8 alfanuméricos), grantType=authorization_code.
 *  - Retorno: {redirectUrl}?code=…&region=…&state=… — o code vale 30 s.
 *  - POST /v2/user/oauth/token {code, redirectUrl, grantType} com Authorization: Sign Base64(HMAC(appSecret, corpo)).
 *  - Token de acesso vale 30 dias; refresh token 60 dias; POST /v2/user/refresh {rt} (Sign) renova os dois.
 *  - GET /v2/device/thing?num=0 com Authorization: Bearer {at} lista os dispositivos e seus `params`.
 *  - UIID 1770 (sensor Zigbee de temperatura/umidade): temperature e humidity = valor × 100 (texto),
 *    battery 0–100, trigTime = instante da última medição em ms.
 *  - Liga/desliga: params.switch 'on'|'off' (1 canal) ou params.switches[{switch, outlet}] (vários canais).
 *  - App gratuito: 50 000 chamadas/mês por região; intervalo ≥ 500 ms e ≤ 300 chamadas/5 min por IP.
 *
 * NÃO foi testado contra a API real (não há conta/dispositivos neste ambiente). Foi testado contra um servidor
 * que reproduz os formatos documentados. A primeira conexão real é o teste definitivo.
 */
import type { D1Database } from '@cloudflare/workers-types';
import { FUTURE_TOLERANCE_MS, isValidHumidityPct, isValidTemperatureC } from '@orq/core';
import type { AppConfig, EwelinkStatusDto, Reading } from '@orq/core';
import type { Env } from './env';
import { HttpError, safeEqual } from './http';
import { logError, logInfo } from './logging';
import { clearProviderDevices, deleteSetting, getSetting, persistReadings, putSetting, replaceProviderDevices } from './repo';
import type { ProviderDevice } from './repo';

export const PROVIDER = 'ewelink';
export const EWELINK_MONTHLY_LIMIT = 50_000;
/** Margem de segurança: acima disso, a leitura automática desacelera para não estourar a cota do mês. */
const SOFT_LIMIT = 46_000;
const OAUTH_PAGE = 'https://c2ccdn.coolkit.cc/oauth/index.html';
const REGION_BASE: Record<string, string> = {
  cn: 'https://cn-apia.coolkit.cn',
  as: 'https://as-apia.coolkit.cc',
  us: 'https://us-apia.coolkit.cc',
  eu: 'https://eu-apia.coolkit.cc',
};
/** UIIDs de sensor de temperatura/umidade cujo formato está documentado e é aceito. */
export const CLIMATE_UIIDS = new Set([1770]);
const TOKEN_KEY = 'ewelink_tokens';
const STATE_KEY = 'ewelink_state';
const OAUTH_STATE_KEY = 'ewelink_oauth_state';
const REQUEST_TIMEOUT_MS = 10_000;
const REFRESH_BEFORE_MS = 5 * 86_400_000;

/* -------------------------------------------------- estado -------------------------------------------------- */

export interface EwelinkState {
  region: string | null;
  connectedAt: number | null;
  lastPollAt: number | null;
  lastSuccessAt: number | null;
  lastError: { at: number; code: string; message: string } | null;
  consecutiveFailures: number;
  callsMonth: string;
  calls: number;
  atExpiresAt: number | null;
  rtExpiresAt: number | null;
}

interface Tokens {
  at: string;
  rt: string;
}

const monthKey = (ms: number) => new Date(ms).toISOString().slice(0, 7);

function emptyState(now: number): EwelinkState {
  return {
    region: null,
    connectedAt: null,
    lastPollAt: null,
    lastSuccessAt: null,
    lastError: null,
    consecutiveFailures: 0,
    callsMonth: monthKey(now),
    calls: 0,
    atExpiresAt: null,
    rtExpiresAt: null,
  };
}

export async function loadState(db: D1Database, now: number): Promise<EwelinkState> {
  const s = (await getSetting<EwelinkState>(db, STATE_KEY)) ?? emptyState(now);
  if (s.callsMonth !== monthKey(now)) {
    s.callsMonth = monthKey(now);
    s.calls = 0;
  }
  return s;
}

export function isConfigured(env: Env): boolean {
  return !!(env.EWELINK_APP_ID && env.EWELINK_APP_SECRET && env.EWELINK_REDIRECT_URL);
}

export async function statusDto(env: Env, db: D1Database, now: number): Promise<EwelinkStatusDto> {
  const s = await loadState(db, now);
  const connected = (await getSetting(db, TOKEN_KEY)) !== null;
  const iso = (v: number | null) => (v === null ? null : new Date(v).toISOString());
  const appExp = env.EWELINK_APP_EXPIRES_AT && /^\d{4}-\d{2}-\d{2}$/.test(env.EWELINK_APP_EXPIRES_AT) ? `${env.EWELINK_APP_EXPIRES_AT}T00:00:00.000Z` : null;
  return {
    configured: isConfigured(env),
    connected,
    region: s.region,
    connectedAt: iso(s.connectedAt),
    lastPollAt: iso(s.lastPollAt),
    lastSuccessAt: iso(s.lastSuccessAt),
    lastError: s.lastError ? { ...s.lastError, at: new Date(s.lastError.at).toISOString() } : null,
    consecutiveFailures: s.consecutiveFailures,
    callsThisMonth: s.calls,
    monthlyLimit: EWELINK_MONTHLY_LIMIT,
    accessExpiresAt: iso(s.atExpiresAt),
    refreshExpiresAt: iso(s.rtExpiresAt),
    appExpiresAt: appExp,
  };
}

/* -------------------------------------------------- cripto -------------------------------------------------- */

const enc = new TextEncoder();
const b64 = (buf: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export async function hmacBase64(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64(await crypto.subtle.sign('HMAC', key, enc.encode(message)));
}

function randomAlnum(n: number): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.getRandomValues(new Uint8Array(n));
  return [...bytes].map((b) => chars[b % chars.length]).join('');
}

/** Chave AES-GCM derivada (HKDF) do segredo do app: os tokens ficam cifrados no banco. */
async function tokenKey(env: Env): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', enc.encode(env.EWELINK_APP_SECRET!), 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: enc.encode('orquidario-inteligente'), info: enc.encode('ewelink-tokens-v1') },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

async function saveTokens(env: Env, db: D1Database, t: Tokens, now: number): Promise<void> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await tokenKey(env), enc.encode(JSON.stringify(t)));
  await putSetting(db, TOKEN_KEY, { v: 1, iv: b64(iv), ct: b64(ct) }, now);
}

async function loadTokens(env: Env, db: D1Database): Promise<Tokens | null> {
  const raw = await getSetting<{ v: number; iv: string; ct: string }>(db, TOKEN_KEY);
  if (!raw) return null;
  try {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(raw.iv) }, await tokenKey(env), unb64(raw.ct));
    return JSON.parse(new TextDecoder().decode(pt)) as Tokens;
  } catch {
    return null; // segredo do app mudou: é preciso conectar de novo
  }
}

/* -------------------------------------------------- HTTP -------------------------------------------------- */

export class EwelinkError extends Error {
  constructor(
    public code: string,
    message: string,
    public apiError?: number,
  ) {
    super(message);
  }
}

function baseUrl(env: Env, region: string): string {
  if (env.EWELINK_API_BASE_OVERRIDE) return env.EWELINK_API_BASE_OVERRIDE.replace(/\/$/, '');
  const b = REGION_BASE[region];
  if (!b) throw new EwelinkError('bad_region', `Região desconhecida: ${region}`);
  return b;
}

async function call<T>(
  env: Env,
  state: EwelinkState,
  region: string,
  path: string,
  opts: { method: 'GET' | 'POST'; body?: unknown; auth: { bearer: string } | 'sign' },
): Promise<T> {
  const body = opts.body === undefined ? undefined : JSON.stringify(opts.body);
  const headers: Record<string, string> = {
    'X-CK-Appid': env.EWELINK_APP_ID!,
    'X-CK-Nonce': randomAlnum(8),
    Accept: 'application/json',
  };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  headers.Authorization = opts.auth === 'sign' ? `Sign ${await hmacBase64(env.EWELINK_APP_SECRET!, body ?? '')}` : `Bearer ${opts.auth.bearer}`;
  state.calls += 1;
  let res: Response;
  try {
    res = await fetch(baseUrl(env, region) + path, { method: opts.method, headers, body, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch (e) {
    throw new EwelinkError('network', `Falha de rede ao falar com o eWeLink: ${(e as Error).name}`);
  }
  if (res.status === 403) throw new EwelinkError('quota', 'Cota mensal do app eWeLink esgotada (HTTP 403).', 403);
  let json: { error?: number; msg?: string; data?: T };
  try {
    json = (await res.json()) as typeof json;
  } catch {
    throw new EwelinkError('bad_response', `Resposta inválida do eWeLink (HTTP ${res.status}).`);
  }
  if (json.error !== 0) {
    const e = json.error ?? -1;
    const code = e === 401 || e === 402 ? 'auth' : e === 412 ? 'quota' : e === 407 ? 'appid_permission' : 'api_error';
    throw new EwelinkError(code, `eWeLink respondeu erro ${e}${json.msg ? `: ${json.msg}` : ''}.`, e);
  }
  return json.data as T;
}

/* -------------------------------------------------- OAuth -------------------------------------------------- */

export async function buildAuthorizeUrl(env: Env, db: D1Database, now: number): Promise<string> {
  if (!isConfigured(env)) {
    throw new HttpError(503, 'ewelink_not_configured', 'Configure EWELINK_APP_ID, EWELINK_APP_SECRET e EWELINK_REDIRECT_URL no servidor.');
  }
  const state = randomAlnum(24);
  await putSetting(db, OAUTH_STATE_KEY, { state, exp: now + 10 * 60_000 }, now);
  const seq = String(now);
  const q = new URLSearchParams({
    state,
    clientId: env.EWELINK_APP_ID!,
    authorization: await hmacBase64(env.EWELINK_APP_SECRET!, `${env.EWELINK_APP_ID}_${seq}`),
    seq,
    redirectUrl: env.EWELINK_REDIRECT_URL!,
    nonce: randomAlnum(8),
    grantType: 'authorization_code',
    showQRCode: 'false',
  });
  return `${env.EWELINK_OAUTH_URL_OVERRIDE ?? OAUTH_PAGE}?${q.toString()}`;
}

/** Retorno do login eWeLink. Valida o `state` (uso único, 10 min) e troca o code (válido 30 s) por tokens. */
export async function handleCallback(env: Env, db: D1Database, q: { code?: string; region?: string; state?: string }, now: number): Promise<void> {
  if (!isConfigured(env)) throw new HttpError(503, 'ewelink_not_configured', 'Integração eWeLink não configurada no servidor.');
  const saved = await getSetting<{ state: string; exp: number }>(db, OAUTH_STATE_KEY);
  await deleteSetting(db, OAUTH_STATE_KEY);
  if (!saved || !q.state || !safeEqual(q.state, saved.state) || now > saved.exp) {
    throw new HttpError(400, 'invalid_state', 'Pedido de conexão expirado ou inválido. Inicie a conexão de novo.');
  }
  if (!q.code || !/^[A-Za-z0-9-]{8,80}$/.test(q.code)) throw new HttpError(400, 'invalid_code', 'Código de autorização ausente ou inválido.');
  const region = q.region ?? '';
  if (!(region in REGION_BASE)) throw new HttpError(400, 'invalid_region', 'Região inválida no retorno do eWeLink.');

  const state = await loadState(db, now);
  try {
    const d = await call<{ accessToken: string; atExpiredTime: number; refreshToken: string; rtExpiredTime: number }>(env, state, region, '/v2/user/oauth/token', {
      method: 'POST',
      body: { code: q.code, redirectUrl: env.EWELINK_REDIRECT_URL, grantType: 'authorization_code' },
      auth: 'sign',
    });
    if (!d?.accessToken || !d.refreshToken) throw new EwelinkError('bad_response', 'O eWeLink não devolveu os tokens.');
    await saveTokens(env, db, { at: d.accessToken, rt: d.refreshToken }, now);
    Object.assign(state, {
      region,
      connectedAt: now,
      atExpiresAt: Number(d.atExpiredTime) || now + 30 * 86_400_000,
      rtExpiresAt: Number(d.rtExpiredTime) || now + 60 * 86_400_000,
      lastError: null,
      consecutiveFailures: 0,
    });
  } catch (e) {
    const err = e instanceof EwelinkError ? e : new EwelinkError('unknown', String(e));
    state.lastError = { at: now, code: err.code, message: err.message };
    await putSetting(db, STATE_KEY, state, now);
    throw new HttpError(502, 'ewelink_token_failed', err.message);
  }
  await putSetting(db, STATE_KEY, state, now);
}

export async function disconnect(db: D1Database, now: number): Promise<void> {
  await deleteSetting(db, TOKEN_KEY);
  await clearProviderDevices(db, PROVIDER);
  const s = await loadState(db, now);
  await putSetting(db, STATE_KEY, { ...emptyState(now), calls: s.calls, callsMonth: s.callsMonth }, now);
}

async function refresh(env: Env, db: D1Database, state: EwelinkState, tokens: Tokens, now: number): Promise<Tokens> {
  const d = await call<{ at: string; rt: string }>(env, state, state.region!, '/v2/user/refresh', { method: 'POST', body: { rt: tokens.rt }, auth: 'sign' });
  if (!d?.at || !d.rt) throw new EwelinkError('bad_response', 'O eWeLink não devolveu os novos tokens.');
  const t = { at: d.at, rt: d.rt };
  await saveTokens(env, db, t, now);
  state.atExpiresAt = now + 30 * 86_400_000;
  state.rtExpiresAt = now + 60 * 86_400_000;
  logInfo('ewelink', 'tokens renovados');
  return t;
}

/* -------------------------------------------------- leitura -------------------------------------------------- */

interface ThingItem {
  itemType?: number;
  itemData?: {
    name?: string;
    deviceid?: string;
    online?: boolean;
    productModel?: string;
    extra?: { uiid?: number; model?: string };
    params?: Record<string, unknown>;
  };
}

const onOff = (v: unknown): 'on' | 'off' | null => (v === 'on' || v === 'off' ? v : null);

/** Interpreta um dispositivo da lista `thingList`. Formatos não documentados ficam como "unsupported" (não entram). */
export function parseThing(item: ThingItem, seenAt: number): ProviderDevice | null {
  if (item.itemType !== 1 && item.itemType !== 2) return null; // 3 = grupo
  const d = item.itemData;
  if (!d?.deviceid || !/^[A-Za-z0-9_-]{1,64}$/.test(d.deviceid)) return null;
  const p = d.params ?? {};
  const uiid = typeof d.extra?.uiid === 'number' ? d.extra.uiid : null;
  const base: ProviderDevice = {
    provider: PROVIDER,
    deviceId: d.deviceid,
    name: String(d.name ?? d.deviceid).slice(0, 80),
    uiid,
    model: (d.productModel ?? d.extra?.model ?? null) as string | null,
    online: typeof d.online === 'boolean' ? d.online : null,
    kind: 'unsupported',
    temperatureC: null,
    humidityPct: null,
    batteryPct: null,
    switchState: null,
    switches: null,
    measuredAt: null,
    seenAt,
  };
  if (uiid !== null && CLIMATE_UIIDS.has(uiid)) {
    const t = Number(p.temperature) / 100;
    const h = Number(p.humidity) / 100;
    const trig = Number(p.trigTime);
    base.kind = 'climate';
    base.temperatureC = p.temperature !== undefined && isValidTemperatureC(t) ? Math.round(t * 100) / 100 : null;
    base.humidityPct = p.humidity !== undefined && isValidHumidityPct(h) ? Math.round(h * 100) / 100 : null;
    const bat = Number(p.battery);
    base.batteryPct = p.battery !== undefined && Number.isFinite(bat) && bat >= 0 && bat <= 100 ? bat : null;
    base.measuredAt = Number.isFinite(trig) && trig > 1_500_000_000_000 ? trig : null;
    return base;
  }
  const single = onOff(p.switch);
  const multi = Array.isArray(p.switches)
    ? (p.switches as { switch?: unknown; outlet?: unknown }[])
        .filter((s) => typeof s?.outlet === 'number')
        .sort((a, b) => (a.outlet as number) - (b.outlet as number))
        .map((s) => onOff(s.switch) ?? 'off')
    : null;
  if (single || (multi && multi.length)) {
    base.kind = 'switch';
    base.switchState = single ?? multi![0] ?? null;
    base.switches = multi && multi.length ? multi : null;
  }
  return base;
}

function readingFromDevice(sensorId: string, d: ProviderDevice, now: number, retentionDays: number): Reading | null {
  if (d.kind !== 'climate' || d.temperatureC === null || d.humidityPct === null || d.measuredAt === null) return null;
  if (d.measuredAt > now + FUTURE_TOLERANCE_MS) return null; // relógio inconsistente: não grava
  if (d.measuredAt < now - retentionDays * 86_400_000) return null;
  return {
    sensorId,
    measuredAt: d.measuredAt,
    receivedAt: now,
    timeBasis: 'source',
    temperatureC: d.temperatureC,
    humidityPct: d.humidityPct,
    batteryPct: d.batteryPct,
    linkQuality: null,
    rssiDbm: null,
    source: PROVIDER,
  };
}

export interface PollResult {
  ran: boolean;
  reason?: string;
  devices?: number;
  inserted?: number;
}

/**
 * Uma rodada de leitura: renova o token se necessário, lê todos os dispositivos, guarda o retrato atual,
 * grava leituras novas dos sensores vinculados (repetidas são ignoradas) e atualiza a saúde da integração.
 */
export async function pollEwelink(env: Env, db: D1Database, config: AppConfig, now: number, opts: { force?: boolean } = {}): Promise<PollResult> {
  if (!isConfigured(env)) return { ran: false, reason: 'not_configured' };
  const state = await loadState(db, now);
  let tokens = await loadTokens(env, db);
  if (!tokens || !state.region) return { ran: false, reason: 'not_connected' };
  // Proteção da cota mensal: perto do limite, lê só a cada 10 min.
  if (!opts.force && state.calls >= SOFT_LIMIT && new Date(now).getUTCMinutes() % 10 >= 2) return { ran: false, reason: 'quota_guard' };

  state.lastPollAt = now;
  try {
    if (state.atExpiresAt !== null && state.atExpiresAt - now < REFRESH_BEFORE_MS) {
      tokens = await refresh(env, db, state, tokens, now);
      await new Promise((r) => setTimeout(r, 600)); // intervalo mínimo entre chamadas
    }
    let data: { thingList?: ThingItem[]; total?: number };
    try {
      data = await call(env, state, state.region, '/v2/device/thing?num=0', { method: 'GET', auth: { bearer: tokens.at } });
    } catch (e) {
      if (!(e instanceof EwelinkError) || e.code !== 'auth') throw e;
      tokens = await refresh(env, db, state, tokens, now); // token inválido/expirado: renova e tenta uma vez
      await new Promise((r) => setTimeout(r, 600));
      data = await call(env, state, state.region, '/v2/device/thing?num=0', { method: 'GET', auth: { bearer: tokens.at } });
    }
    const devices = (data?.thingList ?? []).map((it) => parseThing(it, now)).filter((d): d is ProviderDevice => d !== null);
    await replaceProviderDevices(db, PROVIDER, devices);

    const byId = new Map(devices.map((d) => [d.deviceId, d]));
    const readings = config.sensors
      .map((s) => (s.externalId ? byId.get(s.externalId) : undefined))
      .map((d, i) => (d ? readingFromDevice(config.sensors[i]!.id, d, now, config.retention.rawDays) : null))
      .filter((r): r is Reading => r !== null);
    const inserted = (await persistReadings(db, readings)).filter(Boolean).length;

    state.lastSuccessAt = now;
    state.lastError = null;
    state.consecutiveFailures = 0;
    await putSetting(db, STATE_KEY, state, now);
    return { ran: true, devices: devices.length, inserted };
  } catch (e) {
    const err = e instanceof EwelinkError ? e : new EwelinkError('unknown', (e as Error).message ?? String(e));
    const message =
      err.code === 'auth'
        ? `${err.message} A autorização foi recusada: conecte a conta eWeLink de novo em "Dados e integração".`
        : err.code === 'quota'
          ? `${err.message} A leitura volta no próximo mês ou após reduzir a frequência.`
          : err.message;
    state.lastError = { at: now, code: err.code, message };
    state.consecutiveFailures += 1;
    await putSetting(db, STATE_KEY, state, now);
    logError('ewelink', err, env, { code: err.code });
    return { ran: true, reason: err.code };
  }
}
