/** Registro das irrigações a partir do estado da bomba (ver packages/core/src/irrigation.ts). */
import type { D1Database } from '@cloudflare/workers-types';
import { derivePumpStatus, irrigationAction } from '@orq/core';
import type { AppConfig, IrrigationDto, PumpStatus } from '@orq/core';
import { listProviderDevices } from './repo';
import type { ProviderDevice } from './repo';

/** Guarda irrigações por 2 anos (são poucas linhas). */
export const IRRIGATION_RETENTION_MS = 730 * 86_400_000;

interface Row {
  started_at: number;
  ended_at: number | null;
  last_on_at: number;
  end_reason: 'off' | 'sem_sinal' | null;
}

const toDto = (r: Row): IrrigationDto => ({
  startedAt: new Date(r.started_at).toISOString(),
  endedAt: r.ended_at === null ? null : new Date(r.ended_at).toISOString(),
  lastOnAt: new Date(r.last_on_at).toISOString(),
  endReason: r.end_reason,
  durationMs: (r.ended_at ?? r.last_on_at) - r.started_at,
});

/** Aplica o estado atual da bomba: começa, continua ou termina a irrigação em andamento. */
export async function trackIrrigation(db: D1Database, pump: PumpStatus, now: number): Promise<void> {
  const open = await db.prepare('SELECT * FROM irrigations WHERE ended_at IS NULL ORDER BY started_at DESC LIMIT 1').first<Row>();
  const a = irrigationAction(open ? { startedAt: open.started_at, lastOnAt: open.last_on_at } : null, pump, now);
  if (a.kind === 'start') await db.prepare('INSERT OR IGNORE INTO irrigations (started_at, last_on_at) VALUES (?1, ?1)').bind(a.at).run();
  else if (a.kind === 'continue') await db.prepare('UPDATE irrigations SET last_on_at = ?1 WHERE started_at = ?2').bind(a.at, open!.started_at).run();
  else if (a.kind === 'end')
    await db.prepare('UPDATE irrigations SET ended_at = ?1, end_reason = ?2 WHERE started_at = ?3').bind(a.endedAt, a.reason, open!.started_at).run();
}

/** Irrigações que começaram no intervalo (mais recentes primeiro), até `limit`. */
export async function listIrrigations(db: D1Database, from: number, to: number, limit = 500): Promise<IrrigationDto[]> {
  const r = await db.prepare('SELECT * FROM irrigations WHERE started_at >= ?1 AND started_at <= ?2 ORDER BY started_at DESC LIMIT ?3').bind(from, to, limit).all<Row>();
  return (r.results ?? []).map(toDto);
}

export async function recentIrrigations(db: D1Database, limit: number): Promise<IrrigationDto[]> {
  const r = await db.prepare('SELECT * FROM irrigations ORDER BY started_at DESC LIMIT ?1').bind(limit).all<Row>();
  return (r.results ?? []).map(toDto);
}

/** Estado da bomba a partir do retrato do Sonoff (mesma regra do painel e do registro de irrigações). */
export function pumpStatusOf(config: AppConfig, device: ProviderDevice | undefined, now: number): PumpStatus {
  const channel = device?.switches ? (device.switches[config.pump.outlet] ?? null) : (device?.switchState ?? null);
  return derivePumpStatus(
    { linked: !!config.pump.deviceId, seenAt: device?.seenAt ?? null, online: device?.online ?? null, switchState: device?.kind === 'switch' ? channel : null },
    now,
  );
}

/** Usado pela tarefa agendada e pelo "Ler agora": aplica o último estado conhecido da bomba às irrigações. */
export async function trackPumpFromDb(db: D1Database, config: AppConfig, provider: string, now: number): Promise<void> {
  if (!config.pump.deviceId) return;
  const device = (await listProviderDevices(db, provider)).find((d) => d.deviceId === config.pump.deviceId);
  await trackIrrigation(db, pumpStatusOf(config, device, now), now);
}
