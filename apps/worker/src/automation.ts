/**
 * Executa a automação da bomba a cada rodada agendada (ver packages/core/src/automation.ts para as regras).
 * Cada comando enviado ao Sonoff é registrado em `automation_log` com o motivo e o resultado.
 */
import type { D1Database } from '@cloudflare/workers-types';
import {
  HOUR,
  buildSnapshot,
  decideAutomation,
  emptyAutomationState,
  inchingWidthMs,
  irrigationAdvice,
  localDateTimeString,
  startOfLocalDay,
} from '@orq/core';
import type { AppConfig, AutomationLogEntryDto, AutomationState, AutomationStatusDto, SlotState } from '@orq/core';
import type { Env } from './env';
import { EwelinkError, PROVIDER, isConfigured, pollEwelink, sendDeviceParams, switchParams } from './ewelink';
import { listIrrigations, pumpStatusOf, recentIrrigations, trackPumpFromDb } from './irrigation';
import { logError, logInfo } from './logging';
import { getSetting, latestReadings, listProviderDevices, putSetting } from './repo';
import { weatherFor } from './weather';

const STATE_KEY = 'automation_state';
/** Reaplica o Inching no Sonoff uma vez por dia (caso alguém mude no app). */
const INCHING_REFRESH_MS = 24 * HOUR;

type StoredState = AutomationState & { note?: string | null };

async function logAction(db: D1Database, at: number, action: 'on' | 'off' | 'inching', reason: string, ok: boolean, error: string | null) {
  await db.prepare('INSERT INTO automation_log (at, action, reason, ok, error) VALUES (?1, ?2, ?3, ?4, ?5)').bind(at, action, reason, ok ? 1 : 0, error).run();
}

const errText = (e: unknown) => (e instanceof EwelinkError ? e.message : (e as Error)?.message ?? String(e));

async function ewelinkConnected(env: Env, db: D1Database): Promise<boolean> {
  return isConfigured(env) && (await getSetting(db, 'ewelink_tokens')) !== null;
}

export async function runAutomation(env: Env, db: D1Database, config: AppConfig, now: number): Promise<void> {
  const startedReal = Date.now();
  /** "Agora" coerente com o instante da rodada (o relógio da rodada pode diferir do relógio real em testes). */
  const clock = () => now + (Date.now() - startedReal);
  const cfg = config.automation;
  const nowLocal = localDateTimeString(now);
  const today = nowLocal.slice(0, 10);
  const stored = (await getSetting<StoredState>(db, STATE_KEY)) ?? emptyAutomationState(today);
  const state: StoredState = stored.date === today ? stored : { ...stored, date: today, slots: {} };

  if (cfg.mode === 'desligado' || !config.pump.deviceId || !(await ewelinkConnected(env, db))) {
    state.note = cfg.mode === 'desligado' ? 'Automação desligada' : !config.pump.deviceId ? 'Sonoff da bomba não vinculado' : 'Conta eWeLink não conectada';
    await putSetting(db, STATE_KEY, state, now);
    return;
  }

  const device = (await listProviderDevices(db, PROVIDER)).find((d) => d.deviceId === config.pump.deviceId);
  const pump = pumpStatusOf(config, device, now);
  const multi = !!device?.switches;

  // Sensores, clima e regras (as mesmas da TV).
  const snap = buildSnapshot(config, await latestReadings(db, config.sensors.map((s) => s.id)), now);
  const hottest = snap.sensors.reduce<number | null>((m, x) => (x.valid && x.reading ? Math.max(m ?? -Infinity, x.reading.temperatureC) : m), null);
  const weather = await weatherFor(db, config, now).catch(() => null);
  const wFresh = !!weather?.data && !!weather.fetchedAt && now - Date.parse(weather.fetchedAt) < HOUR;
  const advice = irrigationAdvice({
    rules: config.irrigationRules,
    insideMaxC: hottest,
    sunWm2: wFresh ? weather!.data!.current.directRadiationWm2 : null,
    nowLocal,
    hours: weather?.data?.hours,
  });

  const dayStart = startOfLocalDay(now);
  const todays = await listIrrigations(db, dayStart, now, 100);
  const last = (await recentIrrigations(db, 1))[0];
  const open = last && last.endedAt === null ? last : null;

  const d = decideAutomation({
    cfg,
    runMin: config.pump.maxRunMin,
    pump,
    running: open ? { startedAt: Date.parse(open.startedAt) } : null,
    lastIrrigationAt: last ? Date.parse(last.endedAt ?? last.lastOnAt) : null,
    todayCount: todays.length,
    advice,
    raining: wFresh ? weather!.data!.current.precipitationMm > 0 : null,
    humidityMean: snap.humidity?.mean ?? null,
    nowMs: now,
    nowLocal,
    state,
  });
  Object.assign(state.slots, d.slots);
  state.note = d.note;

  if (d.command) {
    const on = d.command.action === 'on';
    let ok = true;
    let error: string | null = null;
    try {
      await sendDeviceParams(env, db, config.pump.deviceId, switchParams(multi, config.pump.outlet, on), now);
    } catch (e) {
      ok = false;
      error = errText(e);
      logError('automacao', e, env, { action: d.command.action });
    }
    state.lastCommand = { at: now, action: d.command.action, reason: d.command.reason, ok, error };
    await logAction(db, now, d.command.action, d.command.reason, ok, error);
    if (d.command.slot) {
      state.slots[d.command.slot] = ok
        ? ({ status: 'feito', detail: 'irrigação iniciada pelo sistema', at: now } satisfies SlotState)
        : { status: 'adiado', detail: `o Sonoff não respondeu (${error})`, at: now };
    }
    if (!ok) state.note = `Falha ao ${on ? 'ligar' : 'desligar'} a bomba: ${error}`;
    else {
      logInfo('automacao', `${on ? 'ligou' : 'desligou'} a bomba: ${d.command.reason}`);
      // Confirma o novo estado logo em seguida (registro da irrigação mais preciso).
      await new Promise((r) => setTimeout(r, 1500));
      await pollEwelink(env, db, config, clock(), { force: true }).catch(() => undefined);
      await trackPumpFromDb(db, config, PROVIDER, clock()).catch(() => undefined);
    }
  }

  // Camada 1: o próprio Sonoff desliga sozinho após o tempo de irrigação.
  if (cfg.syncInching && device && !multi && !d.command) {
    const widthMs = inchingWidthMs(config.pump.maxRunMin);
    const stale = !state.inching || state.inching.deviceId !== device.deviceId || state.inching.widthMs !== widthMs || now - state.inching.at > INCHING_REFRESH_MS;
    if (stale) {
      const reason = `desligar sozinho após ${config.pump.maxRunMin} min (Inching)`;
      try {
        await sendDeviceParams(env, db, device.deviceId, { pulse: 'on', pulseWidth: widthMs }, now);
        state.inching = { deviceId: device.deviceId, widthMs, at: now };
        await logAction(db, now, 'inching', reason, true, null);
      } catch (e) {
        // Tenta de novo em 1 h (não a cada rodada).
        state.inching = { deviceId: device.deviceId, widthMs: -1, at: now - INCHING_REFRESH_MS + HOUR };
        await logAction(db, now, 'inching', reason, false, errText(e));
      }
    }
  }
  await putSetting(db, STATE_KEY, state, now);
}

export async function automationStatusDto(env: Env, db: D1Database, config: AppConfig, now: number): Promise<AutomationStatusDto> {
  const cfg = config.automation;
  const today = localDateTimeString(now).slice(0, 10);
  const st = await getSetting<StoredState>(db, STATE_KEY);
  const slots = st && st.date === today ? st.slots : {};
  const connected = await ewelinkConnected(env, db);
  const blockedBy =
    cfg.mode === 'desligado' ? null : !isConfigured(env) ? 'Aguardando a credencial do eWeLink no servidor' : !connected ? 'Conecte a conta eWeLink' : !config.pump.deviceId ? 'Escolha o Sonoff da bomba em Configurações' : null;
  return {
    mode: cfg.mode,
    ready: cfg.mode !== 'desligado' && blockedBy === null,
    blockedBy,
    note: st?.note ?? null,
    slots: cfg.mode === 'automatico' ? [...cfg.schedule].sort().map((time) => ({ time, status: slots[time]?.status ?? 'pendente', detail: slots[time]?.detail ?? null })) : [],
    lastCommand: st?.lastCommand ? { ...st.lastCommand, at: new Date(st.lastCommand.at).toISOString() } : null,
    inching: st?.inching && st.inching.widthMs > 0 ? { widthMs: st.inching.widthMs, at: new Date(st.inching.at).toISOString() } : null,
  };
}

export async function automationLog(db: D1Database, from: number, to: number, limit = 500): Promise<AutomationLogEntryDto[]> {
  const r = await db
    .prepare('SELECT at, action, reason, ok, error FROM automation_log WHERE at >= ?1 AND at <= ?2 ORDER BY at DESC, id DESC LIMIT ?3')
    .bind(from, to, limit)
    .all<{ at: number; action: 'on' | 'off' | 'inching'; reason: string; ok: number; error: string | null }>();
  return (r.results ?? []).map((x) => ({ at: new Date(x.at).toISOString(), action: x.action, reason: x.reason, ok: !!x.ok, error: x.error }));
}
