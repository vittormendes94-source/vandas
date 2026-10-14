import { psychroFor } from './psychro';
import type { AppConfig, Freshness, Reading, SensorConfig } from './types';
import { MIN } from './time';

export interface FreshnessRules {
  freshMaxMin: number;
  offlineAfterMin: number;
}

/**
 * Classifica a idade da última leitura com base no instante da MEDIÇÃO (não no do refresh da tela).
 *  - fresh: idade ≤ freshMaxMin
 *  - delayed: freshMaxMin < idade ≤ offlineAfterMin
 *  - unavailable: idade > offlineAfterMin, ou nunca houve leitura
 */
export function classifyFreshness(measuredAt: number | null, nowMs: number, rules: FreshnessRules): Freshness {
  if (measuredAt === null) return 'unavailable';
  const age = Math.max(0, nowMs - measuredAt);
  if (age <= rules.freshMaxMin * MIN) return 'fresh';
  if (age <= rules.offlineAfterMin * MIN) return 'delayed';
  return 'unavailable';
}

export interface SensorState {
  sensor: SensorConfig;
  reading: Reading | null;
  /** Idade da medição em ms; null se não há leitura. */
  ageMs: number | null;
  freshness: Freshness;
  /** Só sensores "fresh" entram em médias e na interpolação. */
  valid: boolean;
  dpvKpa: number | null;
  dewPointC: number | null;
}

export interface Extreme {
  value: number;
  sensorId: string;
}

export interface QuantityStats {
  /** Média dos pontos monitorados válidos (não representa exatamente todo o espaço). */
  mean: number;
  min: Extreme;
  max: Extreme;
  /** max − min entre os pontos válidos. */
  spread: number;
  n: number;
}

export interface Snapshot {
  atMs: number;
  sensors: SensorState[];
  counts: { fresh: number; delayed: number; unavailable: number };
  temperature: QuantityStats | null;
  humidity: QuantityStats | null;
  dpv: QuantityStats | null;
  dewPoint: QuantityStats | null;
  /** Medição mais recente entre todos os sensores (qualquer situação). */
  lastMeasuredAt: number | null;
  lastReceivedAt: number | null;
}

export function quantityStats(items: { sensorId: string; value: number }[]): QuantityStats | null {
  if (items.length === 0) return null;
  let min = items[0]!;
  let max = items[0]!;
  let sum = 0;
  for (const it of items) {
    sum += it.value;
    if (it.value < min.value) min = it;
    if (it.value > max.value) max = it;
  }
  return {
    mean: sum / items.length,
    min: { value: min.value, sensorId: min.sensorId },
    max: { value: max.value, sensorId: max.sensorId },
    spread: max.value - min.value,
    n: items.length,
  };
}

/**
 * Monta o estado do painel. DPV e ponto de orvalho são calculados por sensor ANTES dos resumos.
 * `latest` = última leitura conhecida de cada sensor (a mais recente por instante de medição).
 * `classify` permite regras distintas para tempo real (idade vs. agora) e replay (tolerância).
 */
export function buildSnapshot(
  config: Pick<AppConfig, 'sensors' | 'freshness'>,
  latest: Map<string, Reading | null>,
  atMs: number,
  classify: (measuredAt: number | null) => Freshness = (m) => classifyFreshness(m, atMs, config.freshness),
): Snapshot {
  const sensors: SensorState[] = config.sensors.map((sensor) => {
    const reading = latest.get(sensor.id) ?? null;
    const freshness = classify(reading ? reading.measuredAt : null);
    const valid = freshness === 'fresh' && reading !== null;
    // Calculado por sensor; mostrado também para leituras atrasadas (informativo), mas só entra nos resumos se válido.
    const psy = reading ? psychroFor(reading.temperatureC, reading.humidityPct) : { dpvKpa: null, dewPointC: null };
    return {
      sensor,
      reading,
      ageMs: reading ? Math.max(0, atMs - reading.measuredAt) : null,
      freshness,
      valid,
      dpvKpa: psy.dpvKpa,
      dewPointC: psy.dewPointC,
    };
  });

  const counts = { fresh: 0, delayed: 0, unavailable: 0 };
  for (const s of sensors) counts[s.freshness]++;

  const valid = sensors.filter((s) => s.valid && s.reading);
  const pick = (f: (s: SensorState) => number | null) =>
    quantityStats(
      valid.flatMap((s) => {
        const v = f(s);
        return v === null ? [] : [{ sensorId: s.sensor.id, value: v }];
      }),
    );

  const readings = sensors.flatMap((s) => (s.reading ? [s.reading] : []));
  return {
    atMs,
    sensors,
    counts,
    temperature: pick((s) => s.reading!.temperatureC),
    humidity: pick((s) => s.reading!.humidityPct),
    dpv: pick((s) => s.dpvKpa),
    dewPoint: pick((s) => s.dewPointC),
    lastMeasuredAt: readings.length ? Math.max(...readings.map((r) => r.measuredAt)) : null,
    lastReceivedAt: readings.length ? Math.max(...readings.map((r) => r.receivedAt)) : null,
  };
}

/**
 * Instante de replay: para cada sensor, a leitura mais recente com measuredAt ≤ t.
 * Se estiver a mais de `toleranceMs` de t, o sensor fica "unavailable" no instante (nada é inventado).
 * `readingsBySensor` deve estar ordenado por measuredAt crescente.
 */
export function latestAtOrBefore(sorted: Reading[], t: number): Reading | null {
  let lo = 0;
  let hi = sorted.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid]!.measuredAt <= t) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans >= 0 ? sorted[ans]! : null;
}

export function snapshotAtInstant(
  config: Pick<AppConfig, 'sensors' | 'freshness'>,
  readingsBySensor: Map<string, Reading[]>,
  t: number,
  toleranceMs: number,
): Snapshot {
  const latest = new Map<string, Reading | null>();
  for (const s of config.sensors) latest.set(s.id, latestAtOrBefore(readingsBySensor.get(s.id) ?? [], t));
  // No replay só existem "fresh" (dentro da tolerância) ou "unavailable" (sem leitura no instante).
  return buildSnapshot(config, latest, t, (m) => (m !== null && t - m <= toleranceMs ? 'fresh' : 'unavailable'));
}

export type AlertKind = 'temperature' | 'humidity' | 'dpv';
export interface AlertHit {
  sensorId: string;
  kind: AlertKind;
  value: number;
  direction: 'below' | 'above';
  limit: number;
}

/** Sensores VÁLIDOS fora dos limites configurados. Sem limites configurados, não há alertas. */
export function evaluateAlerts(snapshot: Snapshot, alerts: AppConfig['alerts']): AlertHit[] {
  const hits: AlertHit[] = [];
  for (const s of snapshot.sensors) {
    if (!s.valid || !s.reading) continue;
    const vals: [AlertKind, number | null][] = [
      ['temperature', s.reading.temperatureC],
      ['humidity', s.reading.humidityPct],
      ['dpv', s.dpvKpa],
    ];
    for (const [kind, v] of vals) {
      if (v === null) continue;
      const l = alerts[kind];
      if (l.min !== null && v < l.min) hits.push({ sensorId: s.sensor.id, kind, value: v, direction: 'below', limit: l.min });
      if (l.max !== null && v > l.max) hits.push({ sensorId: s.sensor.id, kind, value: v, direction: 'above', limit: l.max });
    }
  }
  return hits;
}
