import type { Env } from '../env';
import type { AdapterStatus, PollResult, SourceAdapter } from './types';

/**
 * ESQUELETO do adaptador eWeLink — NÃO IMPLEMENTADO DE PROPÓSITO.
 *
 * Nada aqui chama a rede. A documentação oficial do eWeLink (API v2, OAuth2, app de desenvolvedor, cotas,
 * campos de temperatura/umidade de sub-dispositivos Zigbee e do estado do Sonoff) não pôde ser consultada
 * diretamente durante o desenvolvimento, e não há credenciais, ponte nem equipamento para teste real.
 * Implementar endpoints "de memória" seria declarar uma integração que ninguém verificou.
 *
 * Para implementar: siga o checklist em docs/INTEGRACAO-EWELINK.md. O adaptador deve devolver um
 * `IngestReadingsBody` (mesmo contrato da rota /api/v1/ingest/readings), com `measuredAt` da origem quando
 * existir, e NUNCA usar dados simulados como fallback.
 */
export const ewelinkAdapter: SourceAdapter = {
  id: 'ewelink',
  status(env: Env): AdapterStatus {
    if (env.EWELINK_ENABLED !== 'true') {
      return { state: 'not_configured', note: 'Integração eWeLink não configurada. Nenhuma credencial foi fornecida e o acesso à API ainda precisa ser validado.' };
    }
    return {
      state: 'pending_validation',
      note: 'EWELINK_ENABLED=true, mas o adaptador ainda é um esqueleto: depende de validar a API oficial, as credenciais e o modelo do Sonoff da bomba. Nenhum dado é coletado.',
    };
  },
  async poll(): Promise<PollResult> {
    return { kind: 'skipped', reason: 'ewelink_adapter_not_implemented' };
  },
};
