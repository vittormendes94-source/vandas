/**
 * Bomba: somente o estado ATUAL informado pelo Sonoff (ligada/desligada). Nada é registrado em histórico.
 *
 * Regra de segurança: se não há informação recente e confiável, o estado é "desconhecido" — nunca "desligada".
 *  - O eWeLink informa se o Sonoff está online. Offline → sem comunicação.
 *  - Se a própria leitura do eWeLink (a integração) estiver parada há mais que `staleMin`, a informação
 *    mostrada estaria velha → sem comunicação.
 */
import { MIN } from './time';

export type PumpComm = 'ok' | 'offline' | 'stale' | 'not_linked' | 'no_data';
export type PumpState = 'on' | 'off' | 'unknown';

export interface PumpInput {
  linked: boolean;
  /** Última leitura bem-sucedida da integração que incluiu este dispositivo. */
  seenAt: number | null;
  online: boolean | null;
  switchState: 'on' | 'off' | null;
}

export interface PumpStatus {
  comm: PumpComm;
  state: PumpState;
  seenAt: number | null;
}

export const PUMP_STALE_MIN = 10;

export function derivePumpStatus(input: PumpInput, nowMs: number, staleMin = PUMP_STALE_MIN): PumpStatus {
  const { linked, seenAt, online, switchState } = input;
  let comm: PumpComm;
  if (!linked) comm = 'not_linked';
  else if (seenAt === null) comm = 'no_data';
  else if (nowMs - seenAt > staleMin * MIN) comm = 'stale';
  else if (online !== true) comm = 'offline';
  else comm = 'ok';
  return { comm, state: comm === 'ok' && switchState ? switchState : 'unknown', seenAt };
}
