import { z } from 'zod';
import type { Reading } from './types';
import { MIN } from './time';

/**
 * Contrato de ingestão (versão 1) — ver docs/CONTRATO-DE-LEITURAS.md.
 *
 * POST /api/v1/ingest/readings   Authorization: Bearer <INGEST_TOKEN>
 * { "source": "esp32", "readings": [ { "sensorId": "s1", "measuredAt": "2026-09-30T17:05:00Z",
 *                                       "temperatureC": 27.4, "humidityPct": 68.2, "batteryPct": 91 } ] }
 */

const sensorId = z.string().regex(/^[a-z0-9_-]{1,32}$/);
const sourceName = z.string().regex(/^[a-zA-Z0-9._-]{1,40}$/);

export const IngestReadingSchema = z.strictObject({
  sensorId,
  /** ISO 8601 com fuso. Se ausente, usa-se o horário de recebimento (marcado como time_basis='received'). */
  measuredAt: z.iso.datetime({ offset: true }).optional(),
  temperatureC: z.number().finite().min(-40).max(85),
  humidityPct: z.number().finite().min(0).max(100),
  batteryPct: z.number().finite().min(0).max(100).nullish(),
  linkQuality: z.number().finite().min(0).max(255).nullish(),
  rssiDbm: z.number().finite().min(-130).max(20).nullish(),
});

export const IngestReadingsBodySchema = z.strictObject({
  source: sourceName,
  readings: z.array(IngestReadingSchema).min(1).max(100),
});

export type IngestReading = z.infer<typeof IngestReadingSchema>;
export type IngestReadingsBody = z.infer<typeof IngestReadingsBodySchema>;

export type RejectReason = 'unknown_sensor' | 'future_timestamp' | 'too_old';
export type ReadingOutcome =
  | { index: number; status: 'accepted' }
  | { index: number; status: 'duplicate' }
  | { index: number; status: 'rejected'; reason: RejectReason };

/** Tolerância a relógio adiantado do dispositivo. */
export const FUTURE_TOLERANCE_MS = 5 * MIN;

export interface PreparedReading {
  index: number;
  reading: Reading;
}

/**
 * Validação semântica (depois do schema): sensor conhecido, sem timestamp no futuro, dentro da retenção.
 * Retorna leituras normalizadas e rejeições. Duplicidade é resolvida no banco (PK sensor+instante).
 */
export function prepareReadings(
  body: IngestReadingsBody,
  knownSensorIds: Set<string>,
  nowMs: number,
  retentionDays: number,
): { prepared: PreparedReading[]; rejected: ReadingOutcome[] } {
  const prepared: PreparedReading[] = [];
  const rejected: ReadingOutcome[] = [];
  body.readings.forEach((r, index) => {
    if (!knownSensorIds.has(r.sensorId)) return void rejected.push({ index, status: 'rejected', reason: 'unknown_sensor' });
    const hasSourceTime = r.measuredAt !== undefined;
    const measuredAt = hasSourceTime ? Date.parse(r.measuredAt!) : nowMs;
    if (measuredAt > nowMs + FUTURE_TOLERANCE_MS) return void rejected.push({ index, status: 'rejected', reason: 'future_timestamp' });
    if (measuredAt < nowMs - retentionDays * 86_400_000) return void rejected.push({ index, status: 'rejected', reason: 'too_old' });
    prepared.push({
      index,
      reading: {
        sensorId: r.sensorId,
        measuredAt,
        receivedAt: nowMs,
        timeBasis: hasSourceTime ? 'source' : 'received',
        temperatureC: r.temperatureC,
        humidityPct: r.humidityPct,
        batteryPct: r.batteryPct ?? null,
        linkQuality: r.linkQuality ?? null,
        rssiDbm: r.rssiDbm ?? null,
        source: body.source,
      },
    });
  });
  return { prepared, rejected };
}
