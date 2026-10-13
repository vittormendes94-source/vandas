/**
 * Integração SwitchBot (API oficial v1.1) — origem dos sensores Outdoor Meter (IP65), sem computador no local:
 * sensor ──Bluetooth──► Hub Mini/Hub 2/Hub 3 (na tomada) ──Wi-Fi──► nuvem SwitchBot ──► este servidor (a cada 2 min).
 *
 * Fonte: documentação oficial github.com/OpenWonderLabs/SwitchBotAPI (README.md, devices/sensors/*.md), consultada em
 * 13/10/2026:
 *  - Autenticação: cabeçalhos Authorization=<token>, t=<ms>, nonce=<uuid>, sign=Base64(HMAC-SHA256(secret, token+t+nonce)).
 *  - GET /v1.1/devices → body.deviceList[{deviceId, deviceName, deviceType, enableCloudService, hubDeviceId}].
 *  - GET /v1.1/devices/{id}/status → body {temperature (°C, decimal), humidity (%, inteiro), battery}.
 *    Outdoor Meter = deviceType "WoIOSensor"; Meter, MeterPlus, MeterPro e MeterPro(CO2) têm os mesmos campos.
 *  - statusCode 100 = sucesso; 161 aparelho offline; 171 hub offline; 190 erro do aparelho. HTTP 401 = token
 *    inválido OU limite diário (10 000 chamadas) estourado.
 *
 * A resposta de status NÃO traz o horário da medição. Por isso:
 *  - o horário gravado é o do recebimento (time_basis = 'received');
 *  - só se grava leitura quando temperatura ou umidade MUDAM em relação à última gravada. Se o sensor parar e a nuvem
 *    continuar devolvendo o último valor, nada novo é gravado e o painel marca o sensor como atrasado — o valor velho
 *    nunca é "renovado".
 */
import type { D1Database } from '@cloudflare/workers-types';
import { isValidHumidityPct, isValidTemperatureC } from '@orq/core';
import type { AppConfig, Reading, SwitchbotStatusDto } from '@orq/core';
import type { Env } from './env';
import { logError } from './logging';
import { getSetting, latestReadings, listProviderDevices, persistReadings, putSetting, replaceProviderDevices } from './repo';
import type { ProviderDevice } from './repo';

export const SWITCHBOT_PROVIDER = 'switchbot';
const BASE = 'https://api.switch-bot.com';
export const SWITCHBOT_DAILY_LIMIT = 10_000;
/** Acima disso no dia, a leitura automática desacelera para 1 a cada 10 min. */
const SOFT_LIMIT = 8_000;
const STATE_KEY = 'switchbot_state';
const REQUEST_TIMEOUT_MS = 10_000;
/** A lista de aparelhos muda raramente: relida a cada 6 h (ou no "Ler agora"). */
const DEVICE_LIST_EVERY_MS = 6 * 3_600_000;

/** Tipos com temperatura e umidade no status (documentação oficial). */
export const CLIMATE_TYPES: ReadonlyMap<string, string> = new Map([
  ['WoIOSensor', 'Outdoor Meter (IP65)'],
  ['Meter', 'Meter'],
  ['MeterPlus', 'Meter Plus'],
  ['MeterPro', 'Meter Pro'],
  ['MeterPro(CO2)', 'Meter Pro CO2'],
]);
const HUB_TYPES = new Set(['Hub', 'Hub Plus', 'Hub Mini', 'Hub 2', 'Hub 3']);

export interface SwitchbotState {
  lastPollAt: number | null;
  lastSuccessAt: number | null;
  lastError: { at: number; code: string; message: string } | null;
  consecutiveFailures: number;
  callsDay: string;
  calls: number;
  devicesAt: number | null;
}

const dayKey = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const emptyState = (now: number): SwitchbotState => ({
  lastPollAt: null,
  lastSuccessAt: null,
  lastError: null,
  consecutiveFailures: 0,
  callsDay: dayKey(now),
  calls: 0,
  devicesAt: null,
});

export async function loadSwitchbotState(db: D1Database, now: number): Promise<SwitchbotState> {
  const s = (await getSetting<SwitchbotState>(db, STATE_KEY)) ?? emptyState(now);
  if (s.callsDay !== dayKey(now)) Object.assign(s, { callsDay: dayKey(now), calls: 0 });
  return s;
}

export function isSwitchbotConfigured(env: Env): boolean {
  return !!(env.SWITCHBOT_TOKEN && env.SWITCHBOT_SECRET);
}

export async function switchbotStatusDto(env: Env, db: D1Database, now: number): Promise<SwitchbotStatusDto> {
  const s = await loadSwitchbotState(db, now);
  const iso = (v: number | null) => (v === null ? null : new Date(v).toISOString());
  return {
    configured: isSwitchbotConfigured(env),
    lastPollAt: iso(s.lastPollAt),
    lastSuccessAt: iso(s.lastSuccessAt),
    lastError: s.lastError ? { ...s.lastError, at: new Date(s.lastError.at).toISOString() } : null,
    consecutiveFailures: s.consecutiveFailures,
    callsToday: s.calls,
    dailyLimit: SWITCHBOT_DAILY_LIMIT,
  };
}

/* ------------------------------------------------ chamadas à API ------------------------------------------------ */

export class SwitchbotError extends Error {
  constructor(
    readonly code: 'auth' | 'quota' | 'network' | 'bad_response' | 'device_offline' | 'hub_offline' | 'device_error' | 'unknown',
    message: string,
  ) {
    super(message);
  }
}

/** sign = Base64(HMAC-SHA256(secret, token + t + nonce)) — exemplos oficiais em Python 3 e JavaScript. */
export async function switchbotSign(token: string, secret: string, t: string, nonce: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(token + t + nonce)));
  let bin = '';
  for (const b of mac) bin += String.fromCharCode(b);
  return btoa(bin);
}

async function sbGet<T>(env: Env, state: SwitchbotState, path: string): Promise<T> {
  const t = String(Date.now());
  const nonce = crypto.randomUUID();
  state.calls += 1;
  let res: Response;
  try {
    res = await fetch(`${env.SWITCHBOT_API_BASE_OVERRIDE ?? BASE}${path}`, {
      headers: {
        Authorization: env.SWITCHBOT_TOKEN!,
        sign: await switchbotSign(env.SWITCHBOT_TOKEN!, env.SWITCHBOT_SECRET!, t, nonce),
        t,
        nonce,
        'Content-Type': 'application/json; charset=utf8',
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (e) {
    throw new SwitchbotError('network', `Sem resposta da SwitchBot (${(e as Error).name === 'TimeoutError' ? 'tempo esgotado' : (e as Error).message}).`);
  }
  if (res.status === 401)
    throw new SwitchbotError('auth', `SwitchBot recusou o acesso (401): token/segredo inválidos${state.calls > SWITCHBOT_DAILY_LIMIT - 50 ? ' ou limite diário de chamadas atingido' : ''}.`);
  if (res.status === 429) throw new SwitchbotError('quota', 'SwitchBot: limite de chamadas atingido (429).');
  if (!res.ok) throw new SwitchbotError('network', `SwitchBot respondeu HTTP ${res.status}.`);
  const json = (await res.json().catch(() => null)) as { statusCode?: number; message?: string; body?: T } | null;
  if (!json || typeof json.statusCode !== 'number') throw new SwitchbotError('bad_response', 'Resposta da SwitchBot em formato inesperado.');
  if (json.statusCode === 161) throw new SwitchbotError('device_offline', 'Sensor sem comunicação com o hub (161).');
  if (json.statusCode === 171) throw new SwitchbotError('hub_offline', 'Hub SwitchBot offline (171): confira a tomada e o Wi-Fi do hub.');
  if (json.statusCode !== 100) throw new SwitchbotError('device_error', `SwitchBot respondeu código ${json.statusCode}${json.message ? `: ${json.message}` : ''}.`);
  return json.body as T;
}

interface SbDevice {
  deviceId?: unknown;
  deviceName?: unknown;
  deviceType?: unknown;
  enableCloudService?: unknown;
}

/** Converte um item da lista oficial. Aparelhos sem temperatura/umidade ficam "unsupported" (hub inclusive). */
export function parseSbDevice(d: SbDevice, now: number): ProviderDevice | null {
  if (typeof d.deviceId !== 'string' || !/^[A-Za-z0-9:_-]{4,40}$/.test(d.deviceId)) return null;
  const type = typeof d.deviceType === 'string' ? d.deviceType : '';
  const climate = CLIMATE_TYPES.get(type);
  return {
    provider: SWITCHBOT_PROVIDER,
    deviceId: d.deviceId,
    name: typeof d.deviceName === 'string' && d.deviceName ? d.deviceName.slice(0, 80) : d.deviceId,
    uiid: null,
    model: climate ?? (HUB_TYPES.has(type) ? type : type || null),
    // Sem "Serviço de nuvem" ligado no app, a API não entrega o status do sensor Bluetooth.
    online: d.enableCloudService === false ? false : null,
    kind: climate ? 'climate' : 'unsupported',
    temperatureC: null,
    humidityPct: null,
    batteryPct: null,
    rssiDbm: null,
    switchState: null,
    switches: null,
    measuredAt: null,
    seenAt: now,
  };
}

/* ------------------------------------------------ leitura periódica ------------------------------------------------ */

export interface SwitchbotPollResult {
  ran: boolean;
  reason?: string;
  devices?: number;
  inserted?: number;
}

export async function pollSwitchbot(env: Env, db: D1Database, config: AppConfig, now: number, opts: { force?: boolean } = {}): Promise<SwitchbotPollResult> {
  if (!isSwitchbotConfigured(env)) return { ran: false, reason: 'not_configured' };
  const state = await loadSwitchbotState(db, now);
  if (!opts.force && state.calls >= SOFT_LIMIT && new Date(now).getUTCMinutes() % 10 >= 2) return { ran: false, reason: 'quota_guard' };
  state.lastPollAt = now;
  try {
    // 1) Lista de aparelhos (a cada 6 h, ou quando forçado / ainda vazia).
    let devices = await listProviderDevices(db, SWITCHBOT_PROVIDER);
    if (opts.force || devices.length === 0 || state.devicesAt === null || now - state.devicesAt > DEVICE_LIST_EVERY_MS) {
      const body = await sbGet<{ deviceList?: SbDevice[] }>(env, state, '/v1.1/devices');
      const prev = new Map(devices.map((d) => [d.deviceId, d]));
      devices = (body?.deviceList ?? [])
        .map((d) => parseSbDevice(d, now))
        .filter((d): d is ProviderDevice => d !== null)
        .map((d) => {
          const p = prev.get(d.deviceId); // mantém os últimos valores lidos
          return p ? { ...d, temperatureC: p.temperatureC, humidityPct: p.humidityPct, batteryPct: p.batteryPct, measuredAt: p.measuredAt } : d;
        });
      state.devicesAt = now;
    }

    // 2) Status só dos sensores vinculados a S1–S3.
    const byId = new Map(devices.map((d) => [d.deviceId, d]));
    const linked = config.sensors.filter((s) => s.externalId && byId.get(s.externalId)?.kind === 'climate');
    const latest = await latestReadings(db, linked.map((s) => s.id));
    const readings: Reading[] = [];
    const deviceErrors: string[] = [];
    for (const s of linked) {
      const d = byId.get(s.externalId!)!;
      try {
        const st = await sbGet<{ temperature?: unknown; humidity?: unknown; battery?: unknown }>(env, state, `/v1.1/devices/${encodeURIComponent(d.deviceId)}/status`);
        const t = typeof st?.temperature === 'number' ? st.temperature : NaN;
        const h = typeof st?.humidity === 'number' ? st.humidity : NaN;
        if (!isValidTemperatureC(t) || !isValidHumidityPct(h)) throw new SwitchbotError('bad_response', `Valores inválidos de "${d.name}".`);
        const battery = typeof st?.battery === 'number' && st.battery >= 0 && st.battery <= 100 ? st.battery : null;
        Object.assign(d, { temperatureC: t, humidityPct: h, batteryPct: battery, online: true, seenAt: now });
        const last = latest.get(s.id);
        // Só grava quando o valor MUDA: a API não informa o horário da medição (ver cabeçalho do arquivo).
        if (!last || last.temperatureC !== t || last.humidityPct !== h) {
          d.measuredAt = now;
          readings.push({ sensorId: s.id, measuredAt: now, receivedAt: now, timeBasis: 'received', temperatureC: t, humidityPct: h, batteryPct: battery, linkQuality: null, rssiDbm: null, source: SWITCHBOT_PROVIDER });
        }
      } catch (e) {
        if (!(e instanceof SwitchbotError) || e.code === 'auth' || e.code === 'quota' || e.code === 'network') throw e;
        d.online = false;
        deviceErrors.push(`${d.name}: ${e.message}`);
      }
    }
    await replaceProviderDevices(db, SWITCHBOT_PROVIDER, devices);
    const inserted = (await persistReadings(db, readings)).filter(Boolean).length;

    state.lastSuccessAt = now;
    state.lastError = deviceErrors.length ? { at: now, code: 'device', message: deviceErrors.join(' · ') } : null;
    state.consecutiveFailures = deviceErrors.length ? state.consecutiveFailures + 1 : 0;
    await putSetting(db, STATE_KEY, state, now);
    return { ran: true, devices: devices.length, inserted, ...(deviceErrors.length ? { reason: 'device' } : {}) };
  } catch (e) {
    const err = e instanceof SwitchbotError ? e : new SwitchbotError('unknown', (e as Error).message ?? String(e));
    const message = err.code === 'auth' ? `${err.message} Confira SWITCHBOT_TOKEN e SWITCHBOT_SECRET (app SwitchBot → Opções de desenvolvedor) e publique de novo.` : err.message;
    state.lastError = { at: now, code: err.code, message };
    state.consecutiveFailures += 1;
    await putSetting(db, STATE_KEY, state, now);
    logError('switchbot', err, env, { code: err.code });
    return { ran: true, reason: err.code };
  }
}
