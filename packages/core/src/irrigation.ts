import type { IrrigationPeriod, Reading, RelayTransition } from './types';
import { MIN } from './time';

/**
 * Transições de estado do relé → períodos com estado "ligado" OBSERVADO.
 *
 * Isso descreve o que o controlador (Sonoff) informou. Não há sensor de vazão: não se afirma volume aplicado
 * nem água efetivamente distribuída.
 *
 * `transitions` deve incluir, se existir, a última transição anterior à janela (para saber o estado inicial).
 * Transições repetidas do mesmo estado são ignoradas. Mensagens fora de ordem devem ser ordenadas antes.
 */
export function derivePeriods(transitions: RelayTransition[]): IrrigationPeriod[] {
  const sorted = [...transitions].sort((a, b) => a.at - b.at);
  const out: IrrigationPeriod[] = [];
  let open: number | null = null;
  for (const tr of sorted) {
    if (tr.state === 'on') {
      if (open === null) open = tr.at;
    } else if (open !== null) {
      out.push({ startedAt: open, endedAt: Math.max(tr.at, open) });
      open = null;
    }
  }
  if (open !== null) out.push({ startedAt: open, endedAt: null });
  return out;
}

/** Períodos que tocam a janela [from, to]. `nowMs` fecha períodos abertos para fins de sobreposição. */
export function periodsInRange(periods: IrrigationPeriod[], from: number, to: number, nowMs: number): IrrigationPeriod[] {
  return periods.filter((p) => p.startedAt <= to && (p.endedAt ?? nowMs) >= from);
}

export type RelayComm = 'ok' | 'lost' | 'no_data';
export type RelayStateShown = 'on' | 'off' | 'unknown';

export interface RelayStatusInput {
  lastState: 'on' | 'off' | null;
  lastStateAt: number | null;
  /** Última mensagem de qualquer tipo recebida do relé (estado ou heartbeat). */
  lastSeenAt: number | null;
  /** Informado pela origem, se disponível. */
  online: boolean | null;
}

export interface RelayStatus {
  comm: RelayComm;
  /** "unknown" sempre que a comunicação está perdida ou nunca existiu: NÃO se assume "desligado". */
  state: RelayStateShown;
  lastKnownState: 'on' | 'off' | null;
  lastSeenAt: number | null;
  lastStateAt: number | null;
}

export function deriveRelayStatus(input: RelayStatusInput, nowMs: number, freshMaxMin: number | null): RelayStatus {
  const { lastState, lastStateAt, lastSeenAt, online } = input;
  let comm: RelayComm;
  if (lastSeenAt === null && lastState === null) comm = 'no_data';
  else if (online === false) comm = 'lost';
  else if (freshMaxMin !== null && lastSeenAt !== null && nowMs - lastSeenAt > freshMaxMin * MIN) comm = 'lost';
  else comm = 'ok';
  return {
    comm,
    state: comm === 'ok' && lastState ? lastState : 'unknown',
    lastKnownState: lastState,
    lastSeenAt,
    lastStateAt,
  };
}

/* ------------------------------------------------------------------------------------------------
 * Comparação ambiental antes/depois — variação OBSERVADA, sem atribuição de causa.
 * ---------------------------------------------------------------------------------------------- */

export interface WindowStats {
  n: number;
  tMean: number;
  hMean: number;
}

export interface SensorComparison {
  sensorId: string;
  before: WindowStats | null;
  after: WindowStats | null;
  /** depois − antes; null se alguma janela tiver menos que minSamples leituras. */
  deltaT: number | null;
  deltaH: number | null;
}

export interface EventComparison {
  startedAt: number;
  endedAt: number;
  durationMs: number;
  beforeWindow: { from: number; to: number };
  afterWindow: { from: number; to: number };
  sensors: SensorComparison[];
  /** Verdadeiro se pelo menos um sensor tem dados suficientes nas duas janelas. */
  sufficient: boolean;
}

function windowStats(readings: Reading[], from: number, to: number, minSamples: number): WindowStats | null {
  let n = 0;
  let t = 0;
  let h = 0;
  for (const r of readings) {
    if (r.measuredAt >= from && r.measuredAt < to) {
      n++;
      t += r.temperatureC;
      h += r.humidityPct;
    }
  }
  return n >= minSamples ? { n, tMean: t / n, hMean: h / n } : null;
}

/**
 * Para cada período FECHADO: janela "antes" = [início − W, início); janela "depois" = [fim, fim + W).
 * As janelas são recortadas para não invadir outro período de irrigação (o efeito de um evento
 * não deve contaminar a janela de outro). Exige `minSamples` leituras em cada janela.
 */
export function compareAroundEvents(
  readings: Reading[],
  periods: IrrigationPeriod[],
  sensorIds: string[],
  windowMs: number,
  minSamples = 2,
): EventComparison[] {
  const closed = periods
    .filter((p): p is IrrigationPeriod & { endedAt: number } => p.endedAt !== null)
    .sort((a, b) => a.startedAt - b.startedAt);
  const bySensor = new Map<string, Reading[]>();
  for (const id of sensorIds) bySensor.set(id, []);
  for (const r of readings) bySensor.get(r.sensorId)?.push(r);

  return closed.map((p, i) => {
    const prevEnd = i > 0 ? (closed[i - 1]!.endedAt as number) : -Infinity;
    const nextStart = i < closed.length - 1 ? closed[i + 1]!.startedAt : Infinity;
    const beforeWindow = { from: Math.max(p.startedAt - windowMs, prevEnd), to: p.startedAt };
    const afterWindow = { from: p.endedAt, to: Math.min(p.endedAt + windowMs, nextStart) };
    const sensors: SensorComparison[] = sensorIds.map((sensorId) => {
      const rs = bySensor.get(sensorId) ?? [];
      const before = windowStats(rs, beforeWindow.from, beforeWindow.to, minSamples);
      const after = windowStats(rs, afterWindow.from, afterWindow.to, minSamples);
      return {
        sensorId,
        before,
        after,
        deltaT: before && after ? after.tMean - before.tMean : null,
        deltaH: before && after ? after.hMean - before.hMean : null,
      };
    });
    return {
      startedAt: p.startedAt,
      endedAt: p.endedAt,
      durationMs: p.endedAt - p.startedAt,
      beforeWindow,
      afterWindow,
      sensors,
      sufficient: sensors.some((s) => s.deltaT !== null),
    };
  });
}
