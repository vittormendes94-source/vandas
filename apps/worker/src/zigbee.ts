/**
 * Recebimento do coletor local (Zigbee2MQTT). O coletor é a origem PRINCIPAL dos sensores SNZB-02WD:
 * não depende de permissão de nuvem de terceiros. Ver docs/CONTRATO-DE-LEITURAS.md.
 */
import { FUTURE_TOLERANCE_MS, ZIGBEE_PROVIDER, iso, isoOrNull } from '@orq/core';
import type { AppConfig, CollectorStatusDto, Reading, ZigbeeIngestBody, ZigbeeReadingOutcome } from '@orq/core';
import { getSetting, persistReadings, putSetting, replaceProviderDevices } from './repo';
import type { ProviderDevice } from './repo';

const STATE_KEY = 'collector_state';

interface CollectorState {
  lastContactAt: number;
  version: string;
  startedAt: number;
  mqttConnected: boolean;
  bridgeOnline: boolean | null;
  queued: number;
  clockSkewMs: number;
  lastReadingAt: number | null;
  lastRejected: number;
  problem: string | null;
}

export async function collectorStatusDto(db: D1Database): Promise<CollectorStatusDto | null> {
  const s = await getSetting<CollectorState>(db, STATE_KEY);
  if (!s) return null;
  return {
    lastContactAt: iso(s.lastContactAt),
    version: s.version,
    startedAt: iso(s.startedAt),
    mqttConnected: s.mqttConnected,
    bridgeOnline: s.bridgeOnline,
    queued: s.queued,
    clockSkewMs: s.clockSkewMs,
    lastReadingAt: isoOrNull(s.lastReadingAt),
    lastRejected: s.lastRejected,
    problem: s.problem ?? null,
  };
}

export interface ZigbeeIngestResult {
  accepted: number;
  duplicates: number;
  unlinked: number;
  rejected: number;
  results: ZigbeeReadingOutcome[];
}

export async function ingestZigbee(db: D1Database, config: AppConfig, body: ZigbeeIngestBody, now: number): Promise<ZigbeeIngestResult> {
  // 1) Retrato dos dispositivos (para vincular em Configurações). Não é histórico.
  if (body.devices) {
    const devices: ProviderDevice[] = body.devices.map((d) => ({
      provider: ZIGBEE_PROVIDER,
      deviceId: d.ieee,
      name: d.name,
      uiid: null,
      model: [d.vendor, d.model].filter(Boolean).join(' ') || null,
      online: null,
      kind: d.climate ? 'climate' : 'unsupported',
      temperatureC: d.temperatureC ?? null,
      humidityPct: d.humidityPct ?? null,
      batteryPct: d.batteryPct ?? null,
      rssiDbm: null,
      switchState: null,
      switches: null,
      measuredAt: d.lastSeen ? Date.parse(d.lastSeen) : null,
      seenAt: now,
    }));
    await replaceProviderDevices(db, ZIGBEE_PROVIDER, devices);
  }

  // 2) Leituras: só dos sensores vinculados; o resto é ignorado (não há como saber a qual ponto do mapa pertence).
  const sensorByIeee = new Map(config.sensors.filter((s) => s.externalId).map((s) => [s.externalId!, s.id]));
  const results: ZigbeeReadingOutcome[] = [];
  const pending: { index: number; reading: Reading }[] = [];
  body.readings.forEach((r, index) => {
    const sensorId = sensorByIeee.get(r.ieee);
    if (!sensorId) return void results.push({ index, status: 'unlinked' });
    const measuredAt = Date.parse(r.measuredAt);
    if (measuredAt > now + FUTURE_TOLERANCE_MS) return void results.push({ index, status: 'rejected', reason: 'future_timestamp' });
    if (measuredAt < now - config.retention.rawDays * 86_400_000) return void results.push({ index, status: 'rejected', reason: 'too_old' });
    pending.push({
      index,
      reading: {
        sensorId,
        measuredAt,
        receivedAt: now,
        timeBasis: 'source',
        temperatureC: r.temperatureC,
        humidityPct: r.humidityPct,
        batteryPct: r.batteryPct ?? null,
        linkQuality: r.linkQuality ?? null,
        rssiDbm: null,
        source: ZIGBEE_PROVIDER,
      },
    });
  });
  const inserted = pending.length ? await persistReadings(db, pending.map((p) => p.reading)) : [];
  pending.forEach((p, i) => results.push({ index: p.index, status: inserted[i] ? 'accepted' : 'duplicate' }));
  results.sort((a, b) => a.index - b.index);

  // 3) Estado do coletor (sinal de vida, fila, relógio).
  const prev = await getSetting<CollectorState>(db, STATE_KEY);
  const c = body.collector;
  const lastAccepted = pending.filter((_, i) => inserted[i]).reduce<number | null>((m, p) => Math.max(m ?? 0, p.reading.measuredAt), null);
  const state: CollectorState = {
    lastContactAt: now,
    version: c.version,
    startedAt: Date.parse(c.startedAt),
    mqttConnected: c.mqttConnected,
    bridgeOnline: c.bridgeOnline,
    queued: c.queued,
    clockSkewMs: Date.parse(c.sentAt) - now,
    lastReadingAt: Math.max(prev?.lastReadingAt ?? 0, lastAccepted ?? 0) || null,
    lastRejected: results.filter((r) => r.status === 'rejected').length,
    problem: c.problem,
  };
  await putSetting(db, STATE_KEY, state, now);

  const count = (s: ZigbeeReadingOutcome['status']) => results.filter((r) => r.status === s).length;
  return { accepted: count('accepted'), duplicates: count('duplicate'), unlinked: count('unlinked'), rejected: count('rejected'), results };
}
