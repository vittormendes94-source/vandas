import type { IrrigationPeriod, Reading, RelayTransition } from './types';
import { DAY, HOUR, MIN } from './time';

/**
 * Simulador DETERMINÍSTICO de dados de demonstração.
 *
 * Toda leitura é função pura de (sensor, instante): a mesma janela de tempo gera sempre os mesmos valores,
 * então o histórico é reproduzível e pode ser gerado incrementalmente (o "agora" avança sem mudar o passado).
 *
 * Tudo aqui é SIMULADO: as curvas, os setores, as falhas e os eventos de irrigação são ilustrativos e não
 * descrevem o comportamento de nenhum orquidário real. O efeito da irrigação nos valores (queda de temperatura
 * e aumento de umidade) foi imposto apenas para exercitar a comparação antes/depois na interface.
 *
 * O simulador usa UTC−3 fixo (America/Sao_Paulo sem horário de verão desde 2019).
 */

export const DEMO_SOURCE = 'demo-simulador';
export const DEMO_RELAY_ID = 'pump';
export const DEMO_SAMPLE_INTERVAL_MS = 5 * MIN;
export const DEMO_HISTORY_DAYS = 10;
const LOCAL_OFFSET = -3 * HOUR;

export interface DemoSensorProfile {
  id: string;
  tOffset: number;
  hOffset: number;
  batteryStart: number;
  linkQuality: number | null;
  seed: number;
}

export const DEMO_SENSORS: DemoSensorProfile[] = [
  { id: 's1', tOffset: 2.2, hOffset: -7, batteryStart: 88, linkQuality: 190, seed: 11 },
  { id: 's2', tOffset: 0, hOffset: 0, batteryStart: 93, linkQuality: 210, seed: 23 },
  // s3 não informa qualidade de sinal: exercita o caso "dado não fornecido pela integração".
  { id: 's3', tOffset: -1.8, hOffset: 9, batteryStart: 79, linkQuality: null, seed: 37 },
];

/* ---------------------------------- pseudo-aleatório determinístico ---------------------------------- */

function hash32(a: number, b: number, c: number): number {
  let h = (Math.imul(a | 0, 0x9e3779b1) ^ Math.imul(b | 0, 0x85ebca6b) ^ Math.imul(c | 0, 0xc2b2ae35)) >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

/** Uniforme em [0, 1). */
export function rand01(a: number, b: number, c: number): number {
  return hash32(a, b, c) / 4294967296;
}

/** Ruído de valor suave em [−1, 1], contínuo em x. */
export function smoothNoise(seed: number, x: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  const a = rand01(seed, i, 101) * 2 - 1;
  const b = rand01(seed, i + 1, 101) * 2 - 1;
  return a + (b - a) * u;
}

/* ---------------------------------------- irrigação simulada ---------------------------------------- */

const periodCache = new Map<number, IrrigationPeriod[]>();

/** Períodos de irrigação simulados de um dia local (início do dia em UTC ms). */
function dayPeriods(dayStartUtc: number): IrrigationPeriod[] {
  const cached = periodCache.get(dayStartUtc);
  if (cached) return cached;
  const dayIdx = Math.floor((dayStartUtc + LOCAL_OFFSET) / DAY);
  const out: IrrigationPeriod[] = [];
  const add = (hourLocal: number, durMin: number, salt: number) => {
    const jitter = Math.floor(rand01(dayIdx, salt, 5) * 20) * 1000;
    const start = dayStartUtc + hourLocal * HOUR + jitter;
    out.push({ startedAt: start, endedAt: start + durMin * MIN });
  };
  if (rand01(dayIdx, 1, 3) >= 0.05) add(7.5, 5, 1); // manhã (07:30)
  if (rand01(dayIdx, 2, 3) >= 0.08) add(16, 5, 2); // tarde (16:00)
  if (rand01(dayIdx, 3, 3) < 0.12) add(11.33, 3, 3); // evento manual ocasional
  periodCache.set(dayStartUtc, out);
  return out;
}

function localDayStart(utcMs: number): number {
  return Math.floor((utcMs + LOCAL_OFFSET) / DAY) * DAY - LOCAL_OFFSET;
}

/** Períodos simulados que tocam [from, to]. */
export function demoIrrigationPeriods(from: number, to: number): IrrigationPeriod[] {
  const out: IrrigationPeriod[] = [];
  for (let d = localDayStart(from) - DAY; d <= localDayStart(to) + DAY; d += DAY) {
    for (const p of dayPeriods(d)) if (p.startedAt <= to && (p.endedAt ?? p.startedAt) >= from) out.push(p);
  }
  return out.sort((a, b) => a.startedAt - b.startedAt);
}

export function demoRelayTransitions(from: number, to: number): RelayTransition[] {
  const out: RelayTransition[] = [];
  for (const p of demoIrrigationPeriods(from, to)) {
    if (p.startedAt >= from && p.startedAt <= to) out.push({ at: p.startedAt, state: 'on' });
    if (p.endedAt !== null && p.endedAt >= from && p.endedAt <= to) out.push({ at: p.endedAt, state: 'off' });
  }
  return out.sort((a, b) => a.at - b.at);
}

/** Fração 0–1 do "efeito de irrigação" imposto no instante t (rampa durante, decaimento exponencial depois). */
function irrigationEffect(t: number): number {
  let g = 0;
  for (const p of demoIrrigationPeriods(t - 3 * HOUR, t)) {
    const end = p.endedAt ?? p.startedAt;
    if (t < p.startedAt) continue;
    g += t <= end ? (t - p.startedAt) / Math.max(1, end - p.startedAt) : Math.exp(-(t - end) / (30 * MIN));
  }
  return Math.min(1, g);
}

/* ------------------------------------------ falhas simuladas ------------------------------------------ */

/** Falhas de comunicação simuladas: janelas por sensor/dia e uma janela ocasional que derruba os três (ponte). */
export function isDemoOutage(sensorIdx: number, t: number): boolean {
  const dayIdx = Math.floor((t + LOCAL_OFFSET) / DAY);
  const hourLocal = (((t + LOCAL_OFFSET) % DAY) + DAY) % DAY / HOUR;
  if (rand01(sensorIdx + 1, dayIdx, 11) < 0.3) {
    const start = 0.5 + 21 * rand01(sensorIdx + 1, dayIdx, 12);
    const dur = (45 + 165 * rand01(sensorIdx + 1, dayIdx, 13)) / 60;
    if (hourLocal >= start && hourLocal < Math.min(24, start + dur)) return true;
  }
  if (rand01(0, dayIdx, 21) < 0.1) {
    const start = 2 + 18 * rand01(0, dayIdx, 22);
    if (hourLocal >= start && hourLocal < start + 2) return true;
  }
  return false;
}

/* --------------------------------------------- leituras --------------------------------------------- */

export function simulateValues(profile: DemoSensorProfile, t: number): { temperatureC: number; humidityPct: number } {
  const hourLocal = ((((t + LOCAL_OFFSET) % DAY) + DAY) % DAY) / HOUR;
  const days = t / DAY;
  const weatherT = 2.2 * smoothNoise(1, days);
  const weatherH = 6 * smoothNoise(2, days);
  const diurnal = 4.2 * Math.sin((2 * Math.PI * (hourLocal - 8.5)) / 24);
  const tBase = 24.5 + weatherT + diurnal + profile.tOffset;
  const noiseT = 0.25 * smoothNoise(profile.seed, t / (20 * MIN));
  const hBase = 72 + weatherH + profile.hOffset - 2.2 * (tBase - 24.5 - profile.tOffset) + 0.8 * smoothNoise(profile.seed + 1, t / (25 * MIN));
  const g = irrigationEffect(t);
  const temperatureC = tBase + noiseT - 1.5 * g;
  const humidityPct = Math.min(99, Math.max(20, hBase + 8 * g));
  return { temperatureC: Math.round(temperatureC * 10) / 10, humidityPct: Math.round(humidityPct * 10) / 10 };
}

/**
 * Leituras simuladas com measuredAt em [from, to). Amostragem a cada 5 min (+ jitter de segundos) por sensor.
 * Sensores em falha simulada não geram leitura (lacuna real, não preenchida).
 */
export function generateDemoReadings(from: number, to: number): Reading[] {
  const out: Reading[] = [];
  const s0 = Math.floor(from / DEMO_SAMPLE_INTERVAL_MS) - 1;
  const s1 = Math.ceil(to / DEMO_SAMPLE_INTERVAL_MS) + 1;
  DEMO_SENSORS.forEach((profile, idx) => {
    for (let slot = s0; slot <= s1; slot++) {
      const jitter = Math.floor(rand01(profile.seed, slot, 7) * 30) * 1000;
      const measuredAt = slot * DEMO_SAMPLE_INTERVAL_MS + jitter;
      if (measuredAt < from || measuredAt >= to) continue;
      if (isDemoOutage(idx, measuredAt)) continue;
      const { temperatureC, humidityPct } = simulateValues(profile, measuredAt);
      const receivedAt = measuredAt + 1000 + Math.floor(rand01(profile.seed, slot, 9) * 7000);
      const daysSince = (measuredAt - Date.UTC(2026, 0, 1)) / DAY;
      out.push({
        sensorId: profile.id,
        measuredAt,
        receivedAt,
        timeBasis: 'source',
        temperatureC,
        humidityPct,
        batteryPct: Math.min(100, Math.max(20, Math.round(profile.batteryStart - 0.05 * daysSince))),
        linkQuality: profile.linkQuality === null ? null : profile.linkQuality + Math.floor(rand01(profile.seed, slot, 13) * 15) - 7,
        rssiDbm: null,
        source: DEMO_SOURCE,
      });
    }
  });
  return out.sort((a, b) => a.measuredAt - b.measuredAt || a.sensorId.localeCompare(b.sensorId));
}
