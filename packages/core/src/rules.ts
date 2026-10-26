/**
 * Regras de irrigação definidas pelo dono: quando NÃO irrigar (estufa quente, sol direto forte, horário a evitar).
 * A TV mostra "Pode irrigar agora?"; a automação (automation.ts) não liga fora das regras e desliga se a bomba estiver ligada fora delas.
 *
 * Fontes:
 *  - Temperatura: o ponto MAIS QUENTE entre os sensores atualizados da estufa (medido).
 *  - Sol: radiação solar direta estimada para a cidade pelo Open-Meteo (modelo, não medição na estufa).
 */
import { z } from 'zod';
import type { WeatherHour } from './weather';

export interface IrrigationRules {
  /** Não irrigar com a estufa acima disto (°C, ponto mais quente). null = sem regra. */
  maxTempC: number | null;
  /** Não irrigar com sol direto acima disto (W/m²). null = sem regra. */
  maxSunWm2: number | null;
  /** Período do dia a evitar (HH:MM). Os dois null = sem período. Pode atravessar a meia-noite. */
  avoidFrom: string | null;
  avoidTo: string | null;
}

/** Ponto de partida (ajustável em Configurações): estufa até 30 °C e sol direto até 500 W/m². */
export const DEFAULT_IRRIGATION_RULES: IrrigationRules = { maxTempC: 30, maxSunWm2: 500, avoidFrom: null, avoidTo: null };

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM.');
export const IrrigationRulesSchema = z
  .strictObject({
    maxTempC: z.number().finite().min(0).max(60).nullable(),
    maxSunWm2: z.number().finite().min(0).max(1400).nullable(),
    avoidFrom: hhmm.nullable(),
    avoidTo: hhmm.nullable(),
  })
  .refine((r) => (r.avoidFrom === null) === (r.avoidTo === null) && (r.avoidFrom === null || r.avoidFrom !== r.avoidTo), 'Informe início e fim diferentes do período a evitar (ou deixe os dois em branco).');

/** "HH:MM" dentro do período [from, to) — aceita período que atravessa a meia-noite. */
export function inWindow(time: string, from: string, to: string): boolean {
  return from < to ? time >= from && time < to : time >= from || time < to;
}

export type AdviceState = 'ok' | 'no' | 'unknown';

export interface IrrigationAdvice {
  state: AdviceState;
  /** Motivos para não irrigar agora. */
  reasons: string[];
  /** O que não pôde ser avaliado (ex.: sem leitura da estufa). */
  missing: string[];
  /** Próximo horário em que a previsão de sol e o período permitem (HH:MM, com "amanhã" se for o caso). */
  nextGood: string | null;
}

const fmt = (v: number, d = 0) => v.toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });

export function irrigationAdvice(input: {
  rules: IrrigationRules;
  /** Ponto mais quente da estufa agora (°C); null = sem leitura atualizada. */
  insideMaxC: number | null;
  /** Sol direto agora (W/m²); null = sem dado. */
  sunWm2: number | null;
  /** Agora, no horário de São Paulo (AAAA-MM-DDTHH:MM). */
  nowLocal: string;
  hours?: WeatherHour[];
}): IrrigationAdvice {
  const { rules: r, insideMaxC, sunWm2, nowLocal } = input;
  const reasons: string[] = [];
  const missing: string[] = [];
  let evaluated = 0;

  if (r.maxTempC !== null) {
    if (insideMaxC === null) missing.push('sem leitura atual da estufa');
    else {
      evaluated++;
      if (insideMaxC > r.maxTempC) reasons.push(`Estufa a ${fmt(insideMaxC, 1)}° (limite ${fmt(r.maxTempC)}°)`);
    }
  }
  if (r.maxSunWm2 !== null) {
    if (sunWm2 === null) missing.push('sem dado de sol');
    else {
      evaluated++;
      if (sunWm2 > r.maxSunWm2) reasons.push(`Sol forte: ${fmt(sunWm2)} W/m² (limite ${fmt(r.maxSunWm2)})`);
    }
  }
  const time = nowLocal.slice(11, 16);
  if (r.avoidFrom && r.avoidTo) {
    evaluated++;
    if (inWindow(time, r.avoidFrom, r.avoidTo)) reasons.push(`Horário a evitar (${r.avoidFrom}–${r.avoidTo})`);
  }

  const state: AdviceState = reasons.length > 0 ? 'no' : evaluated === 0 ? 'unknown' : 'ok';
  let nextGood: string | null = null;
  // Só dá para prever sol e horário; a temperatura da estufa não tem previsão.
  const onlyTemp = reasons.length > 0 && reasons.every((x) => x.startsWith('Estufa'));
  if (state === 'no' && !onlyTemp && input.hours?.length) {
    const nowHour = `${nowLocal.slice(0, 13)}:00`;
    for (const h of input.hours) {
      if (h.time <= nowHour) continue;
      if (h.time > nextDay(nowLocal)) break;
      const t = h.time.slice(11, 16);
      if (r.avoidFrom && r.avoidTo && inWindow(t, r.avoidFrom, r.avoidTo)) continue;
      // A radiação do Open-Meteo é a média da hora ANTERIOR: a hora seguinte também precisa estar abaixo.
      if (r.maxSunWm2 !== null) {
        const i = input.hours.indexOf(h);
        const next = input.hours[i + 1];
        if (h.directRadiationWm2 === null || h.directRadiationWm2 > r.maxSunWm2) continue;
        if (next && next.directRadiationWm2 !== null && next.directRadiationWm2 > r.maxSunWm2) continue;
      }
      nextGood = h.time.slice(0, 10) === nowLocal.slice(0, 10) ? t : `amanhã ${t}`;
      break;
    }
  }
  return { state, reasons, missing, nextGood };
}

/** Mesmo horário do dia seguinte (limite da busca do próximo horário bom). */
function nextDay(local: string): string {
  const [y, m, d] = local.slice(0, 10).split('-').map(Number) as [number, number, number];
  const n = new Date(Date.UTC(y, m - 1, d + 1));
  return `${n.toISOString().slice(0, 10)}${local.slice(10)}`;
}
