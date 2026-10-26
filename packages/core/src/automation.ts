/**
 * Automação da bomba (sem intervenção humana). Decide, a cada rodada (2 min), se o sistema deve LIGAR ou DESLIGAR
 * o Sonoff. Função pura: o servidor executa o comando e guarda o estado.
 *
 * Camadas de segurança:
 *  1. O próprio Sonoff desliga sozinho após o tempo de irrigação (modo "Inching", sincronizado pelo servidor):
 *     funciona mesmo sem internet.
 *  2. O servidor DESLIGA se a bomba passar do tempo ou se as regras proibirem irrigar (estufa quente, sol forte,
 *     período a evitar) — vale também para irrigações iniciadas por timer do app ou à mão.
 *  3. Nada é ligado sem confirmação recente do estado da bomba, durante chuva (se configurado), além do limite
 *     diário, antes do intervalo mínimo entre irrigações ou com as regras dizendo "não irrigar".
 *
 * Modos: 'desligado' (só monitora), 'protecao' (só desliga), 'automatico' (liga nos horários + protege).
 */
import { z } from 'zod';
import type { PumpStatus } from './pump';
import type { IrrigationAdvice } from './rules';

export type AutomationMode = 'desligado' | 'protecao' | 'automatico';

export interface AutomationConfig {
  mode: AutomationMode;
  /** Horários de irrigação (HH:MM, São Paulo). */
  schedule: string[];
  /** Se um horário estiver bloqueado pelas regras, tenta de novo por até X min; depois, pula. */
  postponeMaxMin: number;
  /** Intervalo mínimo entre o fim de uma irrigação e o início da próxima. */
  minGapMin: number;
  /** Máximo de irrigações por dia (todas, inclusive manuais). */
  maxPerDay: number;
  /** Não irrigar enquanto estiver chovendo na cidade. */
  skipIfRaining: boolean;
  /** Irrigação extra quando a umidade média da estufa ficar abaixo disto (%). null = desativado. */
  humidityBelowPct: number | null;
  /** Configura o desligamento automático ("Inching") no próprio Sonoff com o tempo de irrigação. */
  syncInching: boolean;
}

export const DEFAULT_AUTOMATION: AutomationConfig = {
  mode: 'automatico',
  schedule: [],
  postponeMaxMin: 180,
  minGapMin: 60,
  maxPerDay: 8,
  skipIfRaining: true,
  humidityBelowPct: null,
  syncInching: true,
};

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM.');
export const AutomationConfigSchema = z
  .strictObject({
    mode: z.enum(['desligado', 'protecao', 'automatico']),
    schedule: z.array(hhmm).max(24),
    postponeMaxMin: z.number().int().min(0).max(720),
    minGapMin: z.number().int().min(5).max(1440),
    maxPerDay: z.number().int().min(1).max(48),
    skipIfRaining: z.boolean(),
    humidityBelowPct: z.number().min(10).max(95).nullable(),
    syncInching: z.boolean(),
  })
  .refine((a) => new Set(a.schedule).size === a.schedule.length, 'Há horários repetidos.');

export type SlotStatus = 'feito' | 'pulado' | 'adiado';
export interface SlotState {
  status: SlotStatus;
  detail: string;
  at: number;
}
export interface CommandRecord {
  at: number;
  action: 'on' | 'off';
  reason: string;
  ok: boolean;
  error: string | null;
}
export interface AutomationState {
  /** Dia (AAAA-MM-DD, São Paulo) a que `slots` se refere. */
  date: string;
  slots: Record<string, SlotState>;
  lastCommand: CommandRecord | null;
  /** Último "Inching" aplicado no Sonoff. */
  inching: { deviceId: string; widthMs: number; at: number } | null;
}

export const emptyAutomationState = (date: string): AutomationState => ({ date, slots: {}, lastCommand: null, inching: null });

/** Depois de um comando, espera a confirmação do Sonoff antes de mandar outro. */
export const COMMAND_COOLDOWN_MS = 3 * 60_000;

export interface AutomationInput {
  cfg: AutomationConfig;
  /** Tempo de cada irrigação (min). */
  runMin: number;
  pump: PumpStatus;
  /** Irrigação em andamento (observada). */
  running: { startedAt: number } | null;
  /** Fim (ou último "ligada") da irrigação mais recente. */
  lastIrrigationAt: number | null;
  todayCount: number;
  advice: IrrigationAdvice;
  /** Chovendo agora na cidade? null = sem dado recente. */
  raining: boolean | null;
  humidityMean: number | null;
  nowMs: number;
  /** Agora em São Paulo (AAAA-MM-DDTHH:MM). */
  nowLocal: string;
  state: AutomationState;
}

export interface AutomationDecision {
  command: { action: 'on' | 'off'; reason: string; slot: string | null } | null;
  /** Atualizações de horários de hoje (o servidor grava). */
  slots: Record<string, SlotState>;
  /** Frase curta do que a automação está fazendo/esperando, para a TV. */
  note: string;
}

const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

export function decideAutomation(i: AutomationInput): AutomationDecision {
  const { cfg, pump, nowMs } = i;
  const today = i.nowLocal.slice(0, 10);
  const nowMin = toMin(i.nowLocal.slice(11, 16));
  const prev = i.state.date === today ? i.state.slots : {};
  const slots: Record<string, SlotState> = {};
  const none = (note: string): AutomationDecision => ({ command: null, slots, note });

  if (cfg.mode === 'desligado') return none('Automação desligada');

  const cooling = !!i.state.lastCommand && nowMs - i.state.lastCommand.at < COMMAND_COOLDOWN_MS;
  const known = pump.comm === 'ok' && (pump.state === 'on' || pump.state === 'off');

  // Horários de hoje que já passaram e ainda não foram resolvidos.
  const due = cfg.mode === 'automatico' ? [...cfg.schedule].sort().filter((t) => toMin(t) <= nowMin && prev[t]?.status !== 'feito' && prev[t]?.status !== 'pulado') : [];
  const expired = due.filter((t) => nowMin - toMin(t) > cfg.postponeMaxMin);
  for (const t of expired) slots[t] = { status: 'pulado', detail: prev[t]?.detail ? `não foi possível: ${prev[t]!.detail}` : 'horário já tinha passado', at: nowMs };
  const pending = due.filter((t) => !expired.includes(t));

  if (!known) {
    for (const t of pending) slots[t] = { status: 'adiado', detail: 'sem confirmação do estado da bomba', at: nowMs };
    return none(pump.comm === 'not_linked' ? 'Bomba não conectada' : 'Aguardando confirmação do estado da bomba');
  }

  if (pump.state === 'on') {
    for (const t of pending) slots[t] = { status: 'feito', detail: 'a bomba já estava ligada', at: nowMs };
    const runMs = i.running ? nowMs - i.running.startedAt : 0;
    let off: string | null = null;
    if (i.running && runMs >= i.runMin * 60_000) off = `passou do tempo de ${i.runMin} min`;
    else if (i.advice.state === 'no') off = `fora das regras: ${i.advice.reasons.join('; ')}`;
    if (off) return cooling ? none('Desligando a bomba…') : { command: { action: 'off', reason: off, slot: null }, slots, note: `Desligando: ${off}` };
    return none('Irrigando');
  }

  // Bomba desligada.
  if (cfg.mode !== 'automatico') return none('Proteção ativa: desliga a bomba fora das regras ou do tempo');
  const gapLeft = i.lastIrrigationAt === null ? 0 : i.lastIrrigationAt + cfg.minGapMin * 60_000 - nowMs;
  const blockers = (requireOk: boolean): string | null => {
    if (i.todayCount >= cfg.maxPerDay) return `limite de ${cfg.maxPerDay} irrigações por dia`;
    if (cfg.skipIfRaining && i.raining) return 'está chovendo';
    if (gapLeft > 0) return `intervalo mínimo de ${cfg.minGapMin} min entre irrigações`;
    if (i.advice.state === 'no') return i.advice.reasons.join('; ');
    if (requireOk && i.advice.state !== 'ok') return 'sem dados para avaliar as regras';
    return null;
  };

  if (pending.length > 0) {
    const slot = pending[0]!;
    const b = blockers(false);
    if (b === null) {
      if (cooling) return none('Aguardando o Sonoff confirmar o último comando');
      return { command: { action: 'on', reason: `horário das ${slot}`, slot }, slots, note: `Iniciando a irrigação das ${slot}` };
    }
    // Chuva e limite diário: pula de vez. Regras e intervalo: tenta de novo até o prazo.
    const final = b.startsWith('limite') || b === 'está chovendo';
    for (const t of pending) slots[t] = { status: final ? 'pulado' : 'adiado', detail: b, at: nowMs };
    return none(final ? `Irrigação das ${slot} pulada: ${b}` : `Irrigação das ${slot} adiada: ${b}`);
  }

  if (cfg.humidityBelowPct !== null && i.humidityMean !== null && i.humidityMean < cfg.humidityBelowPct) {
    const b = blockers(true);
    if (b === null && !cooling) {
      return { command: { action: 'on', reason: `umidade da estufa ${Math.round(i.humidityMean)}% (abaixo de ${cfg.humidityBelowPct}%)`, slot: null }, slots, note: 'Irrigação extra: umidade baixa' };
    }
    if (b) return none(`Umidade baixa, mas aguardando: ${b}`);
  }

  const next = [...cfg.schedule].sort().find((t) => toMin(t) > nowMin);
  return none(next ? `Próxima irrigação: ${next}` : cfg.schedule.length ? 'Próxima irrigação: amanhã' : 'Nenhum horário definido');
}

/** Largura do "Inching" (ms) para o tempo de irrigação: múltiplo de 500 ms, como o Sonoff exige. */
export const inchingWidthMs = (runMin: number) => Math.round((runMin * 60_000) / 500) * 500;
