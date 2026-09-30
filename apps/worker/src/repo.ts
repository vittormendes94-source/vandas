import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types';
import { DAY, HOUR, derivePeriods, parseStoredConfig } from '@orq/core';
import type { AppConfig, Dataset, HistorySeries, IrrigationPeriod, Reading, RelayTransition } from '@orq/core';
import { HttpError } from './http';

type Row = Record<string, number | string | null>;

export const RELAY_DEVICE = 'pump';
/** Agregados horários e eventos do relé são mantidos por mais tempo que as leituras brutas. */
export const HOURLY_RETENTION_DAYS = 730;

/* ------------------------------------------ configuração ------------------------------------------ */

export async function getConfig(db: D1Database, dataset: Dataset): Promise<AppConfig> {
  const row = await db
    .prepare('SELECT value FROM settings WHERE dataset = ?1 AND key = ?2')
    .bind(dataset, 'config')
    .first<{ value: string }>();
  if (!row) return parseStoredConfig({}, dataset);
  try {
    return parseStoredConfig(JSON.parse(row.value), dataset);
  } catch {
    return parseStoredConfig({}, dataset);
  }
}

/**
 * Grava a configuração com controle otimista: `next.revision` deve ser a revisão que o cliente leu.
 * Se outra gravação ocorreu no meio, responde 409 e o cliente recarrega.
 */
export async function saveConfig(db: D1Database, dataset: Dataset, next: AppConfig, now: number): Promise<AppConfig> {
  const stored = { ...next, revision: next.revision + 1 };
  const json = JSON.stringify(stored);
  let changes: number;
  if (next.revision === 0) {
    const r = await db
      .prepare('INSERT OR IGNORE INTO settings (dataset, key, value, updated_at) VALUES (?1, ?2, ?3, ?4)')
      .bind(dataset, 'config', json, now)
      .run();
    changes = r.meta.changes ?? 0;
  } else {
    const r = await db
      .prepare(
        `UPDATE settings SET value = ?3, updated_at = ?4
         WHERE dataset = ?1 AND key = ?2 AND json_extract(value, '$.revision') = ?5`,
      )
      .bind(dataset, 'config', json, now, next.revision)
      .run();
    changes = r.meta.changes ?? 0;
  }
  if (changes === 0) {
    throw new HttpError(409, 'revision_conflict', 'A configuração foi alterada por outra sessão. Recarregue e tente novamente.');
  }
  return stored;
}

export async function getCursor(db: D1Database, dataset: Dataset, key: string): Promise<number | null> {
  const row = await db
    .prepare('SELECT value FROM settings WHERE dataset = ?1 AND key = ?2')
    .bind(dataset, key)
    .first<{ value: string }>();
  const n = row ? Number(row.value) : NaN;
  return Number.isFinite(n) ? n : null;
}

export async function setCursor(db: D1Database, dataset: Dataset, key: string, value: number, now: number): Promise<void> {
  await db
    .prepare(
      `INSERT INTO settings (dataset, key, value, updated_at) VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT(dataset, key) DO UPDATE SET value = MAX(CAST(settings.value AS INTEGER), CAST(excluded.value AS INTEGER)), updated_at = excluded.updated_at`,
    )
    .bind(dataset, key, String(value), now)
    .run();
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

function recomputeHourlyStmt(db: D1Database, dataset: Dataset, sensorId: string, hourStart: number): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO readings_hourly (dataset, sensor_id, hour_start, t_avg, t_min, t_max, h_avg, h_min, h_max, n)
       SELECT dataset, sensor_id, ?3, AVG(temperature_c), MIN(temperature_c), MAX(temperature_c),
              AVG(humidity_pct), MIN(humidity_pct), MAX(humidity_pct), COUNT(*)
         FROM readings
        WHERE dataset = ?1 AND sensor_id = ?2 AND measured_at >= ?3 AND measured_at < ?4
        GROUP BY dataset, sensor_id
       ON CONFLICT(dataset, sensor_id, hour_start) DO UPDATE SET
         t_avg = excluded.t_avg, t_min = excluded.t_min, t_max = excluded.t_max,
         h_avg = excluded.h_avg, h_min = excluded.h_min, h_max = excluded.h_max, n = excluded.n`,
    )
    .bind(dataset, sensorId, hourStart, hourStart + HOUR);
}

/**
 * Grava leituras e recalcula os agregados horários afetados, numa única transação (batch).
 * Idempotente: repetir a mesma leitura (mesmo sensor e instante de medição) não altera nada.
 * Mensagens fora de ordem entram normalmente; "última leitura" é sempre a de maior measured_at.
 * Retorna, para cada leitura de entrada, se foi inserida (true) ou ignorada por duplicidade (false).
 */
export async function persistReadings(db: D1Database, dataset: Dataset, readings: Reading[]): Promise<boolean[]> {
  if (readings.length === 0) return [];
  const inserts = readings.map((r) =>
    db
      .prepare(
        `INSERT OR IGNORE INTO readings
           (dataset, sensor_id, measured_at, received_at, time_basis, temperature_c, humidity_pct, battery_pct, link_quality, rssi_dbm, source)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`,
      )
      .bind(dataset, r.sensorId, r.measuredAt, r.receivedAt, r.timeBasis, r.temperatureC, r.humidityPct, r.batteryPct, r.linkQuality, r.rssiDbm, r.source),
  );
  const buckets = new Map<string, { sensorId: string; hourStart: number }>();
  for (const r of readings) {
    const hourStart = Math.floor(r.measuredAt / HOUR) * HOUR;
    buckets.set(`${r.sensorId}@${hourStart}`, { sensorId: r.sensorId, hourStart });
  }
  const recomputes = [...buckets.values()].map((b) => recomputeHourlyStmt(db, dataset, b.sensorId, b.hourStart));
  const results = await db.batch([...inserts, ...recomputes]);
  return readings.map((_, i) => (results[i]!.meta.changes ?? 0) > 0);
}

export async function latestReadings(db: D1Database, dataset: Dataset, sensorIds: string[]): Promise<Map<string, Reading | null>> {
  const stmts = sensorIds.map((id) =>
    db
      .prepare('SELECT * FROM readings WHERE dataset = ?1 AND sensor_id = ?2 ORDER BY measured_at DESC LIMIT 1')
      .bind(dataset, id),
  );
  const results = stmts.length ? await db.batch<Row>(stmts) : [];
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

export async function historyRaw(
  db: D1Database,
  dataset: Dataset,
  sensorIds: string[],
  from: number,
  to: number,
  full: boolean,
): Promise<{ series: HistorySeries[]; truncated: boolean }> {
  // Ordem decrescente + LIMIT: se cortar, preservamos os dados MAIS RECENTES.
  const stmts = sensorIds.map((id) =>
    db
      .prepare(
        `SELECT * FROM readings WHERE dataset = ?1 AND sensor_id = ?2 AND measured_at >= ?3 AND measured_at <= ?4
          ORDER BY measured_at DESC LIMIT ?5`,
      )
      .bind(dataset, id, from, to, RAW_ROW_LIMIT + 1),
  );
  const results = stmts.length ? await db.batch<Row>(stmts) : [];
  let truncated = false;
  const series: HistorySeries[] = sensorIds.map((sensorId, i) => {
    let rows = results[i]?.results ?? [];
    if (rows.length > RAW_ROW_LIMIT) {
      truncated = true;
      rows = rows.slice(0, RAW_ROW_LIMIT);
    }
    rows = [...rows].reverse();
    return {
      sensorId,
      rows: rows.map((r) =>
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

export async function historyHourly(
  db: D1Database,
  dataset: Dataset,
  sensorIds: string[],
  from: number,
  to: number,
): Promise<{ series: HistorySeries[]; truncated: boolean }> {
  const first = Math.floor(from / HOUR) * HOUR;
  const stmts = sensorIds.map((id) =>
    db
      .prepare(
        `SELECT hour_start, t_avg, t_min, t_max, h_avg, h_min, h_max, n FROM readings_hourly
          WHERE dataset = ?1 AND sensor_id = ?2 AND hour_start >= ?3 AND hour_start <= ?4 ORDER BY hour_start`,
      )
      .bind(dataset, id, first, to),
  );
  const results = stmts.length ? await db.batch<Row>(stmts) : [];
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

/* -------------------------------------------- irrigação -------------------------------------------- */

export interface RelayStatusRow {
  lastState: 'on' | 'off' | null;
  lastStateAt: number | null;
  lastSeenAt: number | null;
  online: boolean | null;
}

export async function getRelayStatus(db: D1Database, dataset: Dataset, deviceId = RELAY_DEVICE): Promise<RelayStatusRow> {
  const r = await db
    .prepare('SELECT * FROM relay_status WHERE dataset = ?1 AND device_id = ?2')
    .bind(dataset, deviceId)
    .first<Row>();
  return {
    lastState: (r?.last_state as 'on' | 'off' | null) ?? null,
    lastStateAt: (r?.last_state_at as number | null) ?? null,
    lastSeenAt: (r?.last_seen_at as number | null) ?? null,
    online: r?.online === null || r?.online === undefined ? null : r.online === 1,
  };
}

export interface RelayMessage {
  deviceId: string;
  state?: 'on' | 'off';
  /** Instante do estado informado (UTC ms). */
  changedAt: number;
  receivedAt: number;
  online?: boolean;
  source: string;
}

/**
 * Registra mensagem do relé. Só grava transição quando o estado difere do anterior (no instante),
 * e só avança "último estado" se a mensagem não for mais antiga que a atual (fora de ordem).
 * `last_seen_at` usa o instante de RECEBIMENTO: prova de comunicação, independente do relógio da origem.
 */
export async function recordRelay(db: D1Database, dataset: Dataset, m: RelayMessage): Promise<{ transitionStored: boolean }> {
  let transitionStored = false;
  const stmts: D1PreparedStatement[] = [];
  if (m.state) {
    const prev = await db
      .prepare('SELECT state FROM relay_events WHERE dataset = ?1 AND device_id = ?2 AND changed_at <= ?3 ORDER BY changed_at DESC LIMIT 1')
      .bind(dataset, m.deviceId, m.changedAt)
      .first<{ state: string }>();
    if (!prev || prev.state !== m.state) {
      transitionStored = true;
      stmts.push(
        db
          .prepare('INSERT OR IGNORE INTO relay_events (dataset, device_id, changed_at, state, received_at, source) VALUES (?1, ?2, ?3, ?4, ?5, ?6)')
          .bind(dataset, m.deviceId, m.changedAt, m.state, m.receivedAt, m.source),
      );
    }
  }
  stmts.push(
    db
      .prepare(
        `INSERT INTO relay_status (dataset, device_id, last_state, last_state_at, last_seen_at, online)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(dataset, device_id) DO UPDATE SET
           last_state = CASE WHEN excluded.last_state IS NOT NULL AND (relay_status.last_state_at IS NULL OR excluded.last_state_at >= relay_status.last_state_at)
                             THEN excluded.last_state ELSE relay_status.last_state END,
           last_state_at = CASE WHEN excluded.last_state IS NOT NULL AND (relay_status.last_state_at IS NULL OR excluded.last_state_at >= relay_status.last_state_at)
                                THEN excluded.last_state_at ELSE relay_status.last_state_at END,
           last_seen_at = MAX(COALESCE(relay_status.last_seen_at, 0), excluded.last_seen_at),
           online = COALESCE(excluded.online, relay_status.online)`,
      )
      .bind(dataset, m.deviceId, m.state ?? null, m.state ? m.changedAt : null, m.receivedAt, m.online === undefined ? null : m.online ? 1 : 0),
  );
  await db.batch(stmts);
  return { transitionStored };
}

/** Períodos com estado "ligado" observado que tocam [from, to]. Inclui a transição anterior à janela. */
export async function irrigationPeriods(db: D1Database, dataset: Dataset, from: number, to: number, deviceId = RELAY_DEVICE): Promise<IrrigationPeriod[]> {
  const [prior, within] = await db.batch<Row>([
    db
      .prepare('SELECT changed_at, state FROM relay_events WHERE dataset = ?1 AND device_id = ?2 AND changed_at < ?3 ORDER BY changed_at DESC LIMIT 1')
      .bind(dataset, deviceId, from),
    db
      .prepare('SELECT changed_at, state FROM relay_events WHERE dataset = ?1 AND device_id = ?2 AND changed_at >= ?3 AND changed_at <= ?4 ORDER BY changed_at')
      .bind(dataset, deviceId, from, to),
  ]);
  const transitions: RelayTransition[] = [...(prior?.results ?? []), ...(within?.results ?? [])].map((r) => ({
    at: r.changed_at as number,
    state: r.state as 'on' | 'off',
  }));
  return derivePeriods(transitions).filter((p) => p.startedAt <= to && (p.endedAt === null || p.endedAt >= from));
}

/* -------------------------------------------- retenção -------------------------------------------- */

/**
 * Evita crescimento indefinido: leituras brutas por `rawDays`; agregados horários e eventos por 730 dias.
 * Consultas usam a chave primária composta (por sensor), sem varrer a tabela inteira.
 */
export async function applyRetention(db: D1Database, dataset: Dataset, config: AppConfig, now: number): Promise<{ rawDeleted: number; hourlyDeleted: number }> {
  const rawCut = now - config.retention.rawDays * DAY;
  const hourlyCut = now - HOURLY_RETENTION_DAYS * DAY;
  const stmts: D1PreparedStatement[] = [];
  for (const s of config.sensors) {
    stmts.push(db.prepare('DELETE FROM readings WHERE dataset = ?1 AND sensor_id = ?2 AND measured_at < ?3').bind(dataset, s.id, rawCut));
    stmts.push(db.prepare('DELETE FROM readings_hourly WHERE dataset = ?1 AND sensor_id = ?2 AND hour_start < ?3').bind(dataset, s.id, hourlyCut));
  }
  stmts.push(db.prepare('DELETE FROM relay_events WHERE dataset = ?1 AND device_id = ?2 AND changed_at < ?3').bind(dataset, RELAY_DEVICE, hourlyCut));
  const res = await db.batch(stmts);
  let rawDeleted = 0;
  let hourlyDeleted = 0;
  config.sensors.forEach((_, i) => {
    rawDeleted += res[i * 2]?.meta.changes ?? 0;
    hourlyDeleted += res[i * 2 + 1]?.meta.changes ?? 0;
  });
  return { rawDeleted, hourlyDeleted };
}
