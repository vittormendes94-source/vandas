/**
 * Irrigações: períodos em que a bomba foi vista LIGADA pelo Sonoff (eWeLink), lido a cada 2 min.
 *
 * Precisão: o início é a primeira leitura que viu "ligada" e o fim a primeira que viu "desligada"; cada um pode estar
 * até ~2 min atrasado em relação ao real. Irrigações mais curtas que o intervalo de leitura podem não ser vistas.
 * Sem sinal do Sonoff no meio de uma irrigação, nada é presumido: se o sinal não voltar em 30 min, a irrigação é
 * fechada no último instante em que foi vista ligada, marcada como "sem sinal".
 */
import type { PumpStatus } from './pump';
import { MIN } from './time';

export const IRRIGATION_LOST_AFTER_MS = 30 * MIN;

export interface OpenIrrigation {
  startedAt: number;
  lastOnAt: number;
}

export type IrrigationAction =
  | { kind: 'none' }
  | { kind: 'start'; at: number }
  | { kind: 'continue'; at: number }
  | { kind: 'end'; endedAt: number; reason: 'off' | 'sem_sinal' };

/** Os instantes usam o momento em que o Sonoff foi LIDO (`pump.seenAt`), não o relógio de quem processa. */
export function irrigationAction(open: OpenIrrigation | null, pump: PumpStatus, now: number): IrrigationAction {
  const at = pump.seenAt ?? now;
  if (pump.comm === 'ok' && pump.state === 'on') {
    if (!open) return { kind: 'start', at };
    return at > open.lastOnAt ? { kind: 'continue', at } : { kind: 'none' };
  }
  if (pump.comm === 'ok' && pump.state === 'off') return open && at > open.lastOnAt ? { kind: 'end', endedAt: at, reason: 'off' } : { kind: 'none' };
  // Sem informação confiável: só fecha depois de muito tempo, no último instante em que foi vista ligada.
  if (open && now - open.lastOnAt > IRRIGATION_LOST_AFTER_MS) return { kind: 'end', endedAt: open.lastOnAt, reason: 'sem_sinal' };
  return { kind: 'none' };
}

export interface IrrigationDto {
  startedAt: string;
  /** null = em andamento. */
  endedAt: string | null;
  lastOnAt: string;
  endReason: 'off' | 'sem_sinal' | null;
  /** Duração (fim − início); em andamento: até a última confirmação de "ligada". */
  durationMs: number;
  /** Medições dos sensores logo antes de ligar e ~1 min depois de desligar (null = ainda não medidas). */
  before?: IrrigationSnapshot | null;
  after?: IrrigationSnapshot | null;
}

export interface IrrigationSnapshot {
  /** Instante em que o sistema guardou as medições (ISO). */
  at: string;
  sensors: { id: string; temperatureC: number; humidityPct: number; measuredAt: string }[];
}

/** Mudança média entre as medições de antes e de depois (só sensores presentes nas duas). */
export function irrigationChange(e: Pick<IrrigationDto, 'before' | 'after'>): { dTemp: number; dHum: number; n: number; minutes: number } | null {
  if (!e.before || !e.after) return null;
  const pairs = e.before.sensors.flatMap((b) => {
    const a = e.after!.sensors.find((x) => x.id === b.id);
    return a ? [{ dt: a.temperatureC - b.temperatureC, dh: a.humidityPct - b.humidityPct }] : [];
  });
  if (!pairs.length) return null;
  const mean = (v: number[]) => v.reduce((s, x) => s + x, 0) / v.length;
  return { dTemp: mean(pairs.map((p) => p.dt)), dHum: mean(pairs.map((p) => p.dh)), n: pairs.length, minutes: Math.max(0, Math.round((Date.parse(e.after.at) - Date.parse(e.before.at)) / 60_000)) };
}

export interface IrrigationsSummary {
  last: IrrigationDto[];
  todayCount: number;
  todayTotalMs: number;
}

export function summarizeIrrigations(events: IrrigationDto[], dayStartMs: number, lastN = 5): IrrigationsSummary {
  const sorted = [...events].sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
  const today = sorted.filter((e) => Date.parse(e.startedAt) >= dayStartMs);
  return { last: sorted.slice(0, lastN), todayCount: today.length, todayTotalMs: today.reduce((s, e) => s + e.durationMs, 0) };
}

/** Duração de irrigação: "12 min", "1 h 05 min", "menos de 2 min" (abaixo da precisão da leitura). */
export function formatIrrigationDuration(ms: number): string {
  const m = Math.round(ms / MIN);
  if (m < 2) return 'menos de 2 min';
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
}

/** Totais por dia (America/Sao_Paulo), mais recente primeiro. Irrigação conta no dia em que começou. */
export function irrigationsByDay(events: IrrigationDto[], dayStartOf: (ms: number) => number): { dayStart: number; count: number; totalMs: number }[] {
  const m = new Map<number, { dayStart: number; count: number; totalMs: number }>();
  for (const e of events) {
    const d = dayStartOf(Date.parse(e.startedAt));
    const cur = m.get(d) ?? { dayStart: d, count: 0, totalMs: 0 };
    cur.count += 1;
    cur.totalMs += e.durationMs;
    m.set(d, cur);
  }
  return [...m.values()].sort((a, b) => b.dayStart - a.dayStart);
}
