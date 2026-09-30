import type { D1Database, Fetcher } from '@cloudflare/workers-types';

/**
 * Bindings e variáveis do Worker. Segredos (tokens) vêm de `wrangler secret put` em produção
 * ou de `.dev.vars` em desenvolvimento local. NUNCA vão para o front-end nem para o repositório.
 */
export interface Env {
  DB: D1Database;
  ASSETS?: Fetcher;

  /** "true" (padrão) ou "false": desliga o conjunto de demonstração por completo. */
  DEMO_ENABLED?: string;
  /** Conjunto exibido quando o cliente não escolhe: "demo" (padrão) ou "real". */
  DEFAULT_DATASET?: string;

  /** Se definido, leitura da API exige este token (Bearer, cabeçalho x-view-token ou ?k=). Sem ele, leitura é aberta. */
  VIEW_TOKEN?: string;
  /** Obrigatório para gravar configuração. Sem ele, a rota de configuração responde 503. */
  ADMIN_TOKEN?: string;
  /** Obrigatório para as rotas de ingestão. Sem ele, respondem 503. */
  INGEST_TOKEN?: string;

  /** Reservado: habilitaria o adaptador eWeLink (hoje apenas esqueleto pendente de validação). */
  EWELINK_ENABLED?: string;
}
