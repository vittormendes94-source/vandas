import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types';
import { DAY, HOUR, parseStoredConfig } from '@orq/core';
import type { AppConfig, HistorySeries, Reading } from '@orq/core';
import { HttpError } from './http';

type Row = Record<string, number | string | null>;

/** Agregados horários são mantidos por mais tempo que as leituras brutas. */
export const HOURLY_RETENTION_DAYS = 730;

/* ------------------------------------------ settings (chave/valor) ------------------------------------------ */

export async function getSetting<T>(db: D1Database, key: string): Promise<T | null> {
  const row = await db.prepare('SELECT value FROM settings WHERE key = ?1').bind(key).first<{ value: string }>();
  if (!row) return null;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return null;
  }
}

export function putSettingStmt(db: D1Database, key: string, value: unknown, now: number): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO settings (key, value, updated_at) VALUES (?1, ?2, ?3)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
    .bind(key, JSON.stringify(value), now);
}

export async function putSetting(db: D1Database, key: string, value: unknown, now: number): Promise<void> {
  await putSettingStmt(db, key, value, now).run();
}

export async function deleteSetting(db: D1Database, key: string): Promise<void> {
  await db.prepare('DELETE FROM settings WHERE key = ?1').bind(key).run();
}

/* ------------------------------------------ configuração ------------------------------------------ */

export async function getConfig(db: D1Database): Promise<AppConfig> {
  return parseStoredConfig((await getSetting<unknown>(db, 'config')) ?? {});
}

/**
 * Grava a configuração com controle otimista: `next.revision` deve ser a revisão que o cliente leu.
 * Se outra gravação ocorreu no meio, responde 409 e o cliente recarrega.
 */
export async function saveConfig(db: D1Database, next: AppConfig, now: number): Promise<AppConfig> {
  const stored = { ...next, revision: next.revision + 1 };
  const json = JSON.stringify(stored);
  const r =
    next.revision === 0
      ? await db.prepare('INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES (?1, ?2, ?3)').bind('config', json, now).run()
      : await db
          .prepare(`UPDATE settings SET value = ?2, updated_at = ?3 WHERE key = ?1 AND json_extract(value, '$.revision') = ?4`)
          .bind('config', json, now, next.revision)
          .run();
  if ((r.meta.changes ?? 0) === 0) {
    throw new HttpError(409, 'revision_conflict', 'A configuração foi alterada por outra sessão. Recarregue e tente novamente.');
  }
  return stored;
}

/* -------------------------------------------- leituras -------------------------------------------- */

function rowToReading(r: Row): Reading {
  return {
    sensorId: r.sensor_id as string,
    measuredAt: r.measured_at as number,
    receivedAt: r.received_at as number,
    timeBasis: r.time_basis as 'source' | 'received',
    temperatureC: r.temperature_c as number,
    humidityPct: r.humidity_pct as number,
    batteryPct: (r.battery_pct as number | null) ?? null,
    linkQuality: (r.link_quality as number | null) ?? null,
    rssiDbm: (r.rssi_dbm as number | null) ?? null,
    source: r.source as string,
  };
}

function recomputeHourlyStmt(db: D1Database, sensorId: string, hourStart: number): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO readings_hourly (sensor_id, hour_start, t_avg, t_min, t_max, h_avg, h_min, h_max, n)
       SELECT sensor_id, ?2, AVG(temperature_c), MIN(temperature_c), MAX(temperature_c),
              AVG(humidity_pct), MIN(humidity_pct), MAX(humidity_pct), COUNT(*)
         FROM readings
        WHERE sensor_id = ?1 AND measured_at >= ?2 AND measured_at < ?3
        GROUP BY sensor_id
       ON CONFLICT(sensor_id, hour_start) DO UPDATE SET
         t_avg = excluded.t_avg, t_min = excluded.t_min, t_max = excluded.t_max,
         h_avg = excluded.h_avg, h_min = excluded.h_min, h_max = excluded.h_max, n = excluded.n`,
    )
    .bind(sensorId, hourStart, hourStart + HOUR);
}

/**
 * Grava leituras (idempotente: mesmo sensor + mesmo instante de medição é ignorado) e recalcula apenas os
 * agregados horários das leituras realmente inseridas — consultar o eWeLink a cada 2 min devolve a mesma leitura
 * várias vezes, e isso não pode gerar escrita. Retorna, por leitura, se foi inserida.
 */
export async function persistReadings(db: D1Database, readings: Reading[]): Promise<boolean[]> {
  if (readings.length === 0) return [];
  const results = await db.batch(
    readings.map((r) =>
      db
        .prepare(
          `INSERT OR IGNORE INTO readings
             (sensor_id, measured_at, received_at, time_basis, temperature_c, humidity_pct, battery_pct, link_quality, rssi_dbm, source)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`,
        )
        .bind(r.sensorId, r.measuredAt, r.receivedAt, r.timeBasis, r.temperatureC, r.humidityPct, r.batteryPct, r.linkQuality, r.rssiDbm, r.source),
    ),
  );
  const inserted = readings.map((_, i) => (results[i]!.meta.changes ?? 0) > 0);
  const buckets = new Map<string, { sensorId: string; hourStart: number }>();
  readings.forEach((r, i) => {
    if (!inserted[i]) return;
    const hourStart = Math.floor(r.measuredAt / HOUR) * HOUR;
    buckets.set(`${r.sensorId}@${hourStart}`, { sensorId: r.sensorId, hourStart });
  });
  if (buckets.size) await db.batch([...buckets.values()].map((b) => recomputeHourlyStmt(db, b.sensorId, b.hourStart)));
  return inserted;
}

export async function latestReadings(db: D1Database, sensorIds: string[]): Promise<Map<string, Reading | null>> {
  const results = sensorIds.length
    ? await db.batch<Row>(sensorIds.map((id) => db.prepare('SELECT * FROM readings WHERE sensor_id = ?1 ORDER BY measured_at DESC LIMIT 1').bind(id)))
    : [];
  const out = new Map<string, Reading | null>();
  sensorIds.forEach((id, i) => {
    const row = results[i]?.results?.[0];
    out.set(id, row ? rowToReading(row) : null);
  });
  return out;
}

/** Limite de linhas por sensor em consultas brutas (protege CPU/memória do Worker). */
export const RAW_ROW_LIMIT = 3000;
/** Janela máxima para resolução bruta. Períodos maiores usam o agregado horário. */
export const RAW_MAX_WINDOW_MS = 2 * DAY;
export const HOURLY_MAX_WINDOW_MS = 400 * DAY;

export async function historyRaw(db: D1Database, sensorIds: string[], from: number, to: number, full: boolean): Promise<{ series: HistorySeries[]; truncated: boolean }> {
  // Ordem decrescente + LIMIT: se cortar, preservamos os dados MAIS RECENTES.
  const results = sensorIds.length
    ? await db.batch<Row>(
        sensorIds.map((id) =>
          db
            .prepare('SELECT * FROM readings WHERE sensor_id = ?1 AND measured_at >= ?2 AND measured_at <= ?3 ORDER BY measured_at DESC LIMIT ?4')
            .bind(id, from, to, RAW_ROW_LIMIT + 1),
        ),
      )
    : [];
  let truncated = false;
  const series: HistorySeries[] = sensorIds.map((sensorId, i) => {
    let rows = results[i]?.results ?? [];
    if (rows.length > RAW_ROW_LIMIT) {
      truncated = true;
      rows = rows.slice(0, RAW_ROW_LIMIT);
    }
    return {
      sensorId,
      rows: [...rows].reverse().map((r) =>
        full
          ? [
              r.measured_at as number,
              r.temperature_c as number,
              r.humidity_pct as number,
              r.received_at as number,
              (r.battery_pct as number | null) ?? null,
              (r.link_quality as number | null) ?? null,
              (r.rssi_dbm as number | null) ?? null,
              r.time_basis === 'received' ? 1 : 0,
            ]
          : [r.measured_at as number, r.temperature_c as number, r.humidity_pct as number],
      ),
    };
  });
  return { series, truncated };
}

export async function historyHourly(db: D1Database, sensorIds: string[], from: number, to: number): Promise<{ series: HistorySeries[]; truncated: boolean }> {
  const first = Math.floor(from / HOUR) * HOUR;
  const results = sensorIds.length
    ? await db.batch<Row>(
        sensorIds.map((id) =>
          db
            .prepare(
              `SELECT hour_start, t_avg, t_min, t_max, h_avg, h_min, h_max, n FROM readings_hourly
                WHERE sensor_id = ?1 AND hour_start >= ?2 AND hour_start <= ?3 ORDER BY hour_start`,
            )
            .bind(id, first, to),
        ),
      )
    : [];
  const series = sensorIds.map((sensorId, i) => ({
    sensorId,
    rows: (results[i]?.results ?? []).map((r) => [
      r.hour_start as number,
      r.t_avg as number,
      r.t_min as number,
      r.t_max as number,
      r.h_avg as number,
      r.h_min as number,
      r.h_max as number,
      r.n as number,
    ]),
  }));
  return { series, truncated: false };
}

/* ------------------------------------------ dispositivos do provedor ------------------------------------------ */

export interface ProviderDevice {
  provider: string;
  deviceId: string;
  name: string;
  uiid: number | null;
  model: string | null;
  online: boolean | null;
  kind: 'climate' | 'switch' | 'unsupported';
  temperatureC: number | null;
  humidityPct: number | null;
  batteryPct: number | null;
  switchState: 'on' | 'off' | null;
  switches: ('on' | 'off')[] | null;
  measuredAt: number | null;
  seenAt: number;
}

function rowToDevice(r: Row): ProviderDevice {
  let switches: ('on' | 'off')[] | null = null;
  try {
    switches = r.switches_json ? (JSON.parse(r.switches_json as string) as ('on' | 'off')[]) : null;
  } catch {
    switches = null;
  }
  return {
    provider: r.provider as string,
    deviceId: r.device_id as string,
    name: r.name as string,
    uiid: (r.uiid as number | null) ?? null,
    model: (r.model as string | null) ?? null,
    online: r.online === null || r.online === undefined ? null : r.online === 1,
    kind: r.kind as ProviderDevice['kind'],
    temperatureC: (r.temperature_c as number | null) ?? null,
    humidityPct: (r.humidity_pct as number | null) ?? null,
    batteryPct: (r.battery_pct as number | null) ?? null,
    switchState: (r.switch_state as 'on' | 'off' | null) ?? null,
    switches,
    measuredAt: (r.measured_at as number | null) ?? null,
    seenAt: r.seen_at as number,
  };
}

/** Substitui o retrato dos dispositivos do provedor (uma linha por dispositivo; não é histórico). */
export async function replaceProviderDevices(db: D1Database, provider: string, devices: ProviderDevice[]): Promise<void> {
  const stmts: D1PreparedStatement[] = [db.prepare('DELETE FROM provider_devices WHERE provider = ?1').bind(provider)];
  for (const d of devices) {
    stmts.push(
      db
        .prepare(
          `INSERT INTO provider_devices (provider, device_id, name, uiid, model, online, kind, temperature_c, humidity_pct, battery_pct, switch_state, switches_json, measured_at, seen_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)`,
        )
        .bind(
          provider,
          d.deviceId,
          d.name,
          d.uiid,
          d.model,
          d.online === null ? null : d.online ? 1 : 0,
          d.kind,
          d.temperatureC,
          d.humidityPct,
          d.batteryPct,
          d.switchState,
          d.switches ? JSON.stringify(d.switches) : null,
          d.measuredAt,
          d.seenAt,
        ),
    );
  }
  await db.batch(stmts);
}

export async function listProviderDevices(db: D1Database, provider: string): Promise<ProviderDevice[]> {
  const r = await db.prepare('SELECT * FROM provider_devices WHERE provider = ?1 ORDER BY name').bind(provider).all<Row>();
  return (r.results ?? []).map(rowToDevice);
}

export async function clearProviderDevices(db: D1Database, provider: string): Promise<void> {
  await db.prepare('DELETE FROM provider_devices WHERE provider = ?1').bind(provider).run();
}

/* -------------------------------------------- retenção -------------------------------------------- */

/** Evita crescimento indefinido: leituras brutas por `rawDays`; agregados horários por 730 dias. */
export async function applyRetention(db: D1Database, config: AppConfig, now: number): Promise<{ rawDeleted: number; hourlyDeleted: number }> {
  const rawCut = now - config.retention.rawDays * DAY;
  const hourlyCut = now - HOURLY_RETENTION_DAYS * DAY;
  const res = await db.batch([
    db.prepare('DELETE FROM readings WHERE measured_at < ?1').bind(rawCut),
    db.prepare('DELETE FROM readings_hourly WHERE hour_start < ?1').bind(hourlyCut),
  ]);
  return { rawDeleted: res[0]?.meta.changes ?? 0, hourlyDeleted: res[1]?.meta.changes ?? 0 };
}
