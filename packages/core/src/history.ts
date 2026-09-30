import type { Bucket, Reading } from './types';

export function readingToBucket(r: Reading): Bucket {
  return {
    sensorId: r.sensorId,
    t: r.measuredAt,
    tAvg: r.temperatureC,
    tMin: r.temperatureC,
    tMax: r.temperatureC,
    hAvg: r.humidityPct,
    hMin: r.humidityPct,
    hMax: r.humidityPct,
    n: 1,
  };
}

export interface PeriodExtreme {
  value: number;
  sensorId: string;
  /** Instante (UTC ms): medição exata (bruto) ou início da hora (agregado). */
  t: number;
}

export interface PeriodSummary {
  temperature: { min: PeriodExtreme; max: PeriodExtreme } | null;
  humidity: { min: PeriodExtreme; max: PeriodExtreme } | null;
  samples: number;
}

/** Máximas e mínimas do período, usando min/max dos buckets (não apenas médias horárias). */
export function summarizePeriod(buckets: Bucket[]): PeriodSummary {
  if (buckets.length === 0) return { temperature: null, humidity: null, samples: 0 };
  let tMin = buckets[0]!;
  let tMax = buckets[0]!;
  let hMin = buckets[0]!;
  let hMax = buckets[0]!;
  let samples = 0;
  for (const b of buckets) {
    samples += b.n;
    if (b.tMin < tMin.tMin) tMin = b;
    if (b.tMax > tMax.tMax) tMax = b;
    if (b.hMin < hMin.hMin) hMin = b;
    if (b.hMax > hMax.hMax) hMax = b;
  }
  return {
    temperature: {
      min: { value: tMin.tMin, sensorId: tMin.sensorId, t: tMin.t },
      max: { value: tMax.tMax, sensorId: tMax.sensorId, t: tMax.t },
    },
    humidity: {
      min: { value: hMin.hMin, sensorId: hMin.sensorId, t: hMin.t },
      max: { value: hMax.hMax, sensorId: hMax.sensorId, t: hMax.t },
    },
    samples,
  };
}

export interface Gap {
  sensorId: string;
  /** Instante da última leitura antes da lacuna. */
  from: number;
  /** Instante da primeira leitura depois da lacuna. */
  to: number;
}

/**
 * Lacunas: intervalos entre leituras consecutivas maiores que `thresholdMs`.
 * Períodos sem dados NUNCA são preenchidos: os gráficos quebram a linha nessas lacunas.
 */
export function findGaps(sortedByTime: { t: number }[], sensorId: string, thresholdMs: number): Gap[] {
  const gaps: Gap[] = [];
  for (let i = 1; i < sortedByTime.length; i++) {
    const a = sortedByTime[i - 1]!.t;
    const b = sortedByTime[i]!.t;
    if (b - a > thresholdMs) gaps.push({ sensorId, from: a, to: b });
  }
  return gaps;
}

/** Agrupa por sensor, ordenando por tempo. */
export function groupBySensor<T extends { sensorId: string }>(items: T[], time: (x: T) => number): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const it of items) {
    const arr = m.get(it.sensorId);
    if (arr) arr.push(it);
    else m.set(it.sensorId, [it]);
  }
  for (const arr of m.values()) arr.sort((a, b) => time(a) - time(b));
  return m;
}

/**
 * Redução para desenho: no máximo ~2·maxPoints pontos por série, preservando picos (min/max por coluna).
 * Não interpola nem cria valores: escolhe pontos existentes.
 */
export function downsampleForChart<T extends { t: number }>(series: T[], value: (x: T) => number, maxPoints: number): T[] {
  if (series.length <= maxPoints * 2) return series;
  const t0 = series[0]!.t;
  const t1 = series[series.length - 1]!.t;
  const span = Math.max(1, t1 - t0);
  const cols = new Map<number, { lo: T; hi: T }>();
  for (const p of series) {
    const c = Math.min(maxPoints - 1, Math.floor(((p.t - t0) / span) * maxPoints));
    const cur = cols.get(c);
    if (!cur) cols.set(c, { lo: p, hi: p });
    else {
      if (value(p) < value(cur.lo)) cur.lo = p;
      if (value(p) > value(cur.hi)) cur.hi = p;
    }
  }
  const out: T[] = [];
  for (const c of [...cols.keys()].sort((a, b) => a - b)) {
    const { lo, hi } = cols.get(c)!;
    if (lo === hi) out.push(lo);
    else if (lo.t <= hi.t) out.push(lo, hi);
    else out.push(hi, lo);
  }
  return out;
}
