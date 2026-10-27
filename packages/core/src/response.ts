/**
 * "Depois de cada irrigação": quanto a umidade junto às raízes subiu e quanto tempo levou para voltar ao normal,
 * por sensor. Usa leituras brutas (o SwitchBot grava quando o valor muda; vale o último valor até a próxima).
 */
import type { IrrigationDto } from './irrigation';

export interface RawPoint {
  t: number;
  h: number;
}

export interface SensorResponse {
  sensorId: string;
  /** Irrigações analisadas para este sensor. */
  n: number;
  /** Subida típica da umidade (pontos percentuais, mediana). */
  rise: number;
  /** Tempo típico para voltar a até 2 pontos do valor de antes (min, mediana). null = não voltou no período. */
  recoverMin: number | null;
}

const median = (a: number[]) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2) : NaN;
};

const RECOVER_WITHIN = 12 * 3600_000;

export function irrigationResponse(events: IrrigationDto[], series: Map<string, RawPoint[]>): SensorResponse[] {
  const done = events.filter((e) => e.endedAt !== null).map((e) => ({ s: Date.parse(e.startedAt), e: Date.parse(e.endedAt!) }));
  const out: SensorResponse[] = [];
  for (const [sensorId, pts0] of series) {
    const pts = [...pts0].sort((a, b) => a.t - b.t);
    const rises: number[] = [];
    const recs: number[] = [];
    let notBack = 0;
    for (const ev of done) {
      const before = pts.filter((p) => p.t <= ev.s).pop();
      if (!before || ev.s - before.t > 2 * 3600_000) continue;
      const win = pts.filter((p) => p.t > ev.s && p.t <= ev.e + 3600_000);
      if (!win.length) continue;
      const peak = win.reduce((a, b) => (b.h > a.h ? b : a));
      const rise = peak.h - before.h;
      if (rise < 1) continue;
      rises.push(rise);
      const back = pts.find((p) => p.t > peak.t && p.t <= ev.e + RECOVER_WITHIN && p.h <= before.h + 2);
      if (back) recs.push((back.t - ev.e) / 60_000);
      else notBack++;
    }
    if (!rises.length) continue;
    out.push({ sensorId, n: rises.length, rise: Math.round(median(rises)), recoverMin: recs.length > notBack ? Math.max(0, Math.round(median(recs))) : null });
  }
  return out;
}

/** Leitura simples para o manejo de Vandas (raiz deve molhar bem e secar em poucas horas, antes da noite). */
export function responseAdvice(r: SensorResponse): string {
  if (r.recoverMin === null) return 'A umidade não voltou ao normal em 12 h: irrigação demais ou ventilação fraca (risco de raiz encharcada).';
  if (r.rise < 5) return 'Subida pequena: a água quase não chega a este ponto; conferir o aspersor ou aumentar o tempo.';
  if (r.recoverMin < 60) return 'Seca muito rápido (menos de 1 h): pode valer irrigar um pouco mais ou com mais frequência no calor.';
  if (r.recoverMin > 240) return 'Demora mais de 4 h para secar: reduzir o tempo ou irrigar mais cedo, para secar antes da noite.';
  return 'Dentro do esperado: molha e seca em poucas horas.';
}
