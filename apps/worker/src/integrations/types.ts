import type { IngestReadingsBody, IngestRelayBody } from '@orq/core';
import type { Env } from '../env';

/**
 * Camada de integração SUBSTITUÍVEL. Um adaptador só produz mensagens no formato do contrato de ingestão
 * (ver docs/CONTRATO-DE-LEITURAS.md); quem valida e grava é o mesmo caminho usado pela rota HTTP.
 * Assim a interface e o banco não conhecem eWeLink, ESP32, Home Assistant etc.
 */
export interface AdapterStatus {
  state: 'not_configured' | 'pending_validation' | 'active';
  note: string;
}

export type PollResult =
  | { kind: 'skipped'; reason: string }
  | { kind: 'data'; readings: IngestReadingsBody | null; relay: IngestRelayBody[] };

export interface SourceAdapter {
  id: string;
  status(env: Env): AdapterStatus;
  poll(env: Env, now: number): Promise<PollResult>;
}
