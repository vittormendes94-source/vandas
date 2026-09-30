import type { D1Database, Fetcher } from '@cloudflare/workers-types';

/**
 * Bindings e variáveis do Worker. Segredos vêm de `wrangler secret put` (produção) ou `.dev.vars` (local).
 * NUNCA vão para o front-end nem para o repositório.
 */
export interface Env {
  DB: D1Database;
  ASSETS?: Fetcher;

  /** Obrigatório para gravar configuração e conectar o eWeLink. */
  ADMIN_TOKEN?: string;
  /** Obrigatório para a rota genérica de ingestão (ESP32/scripts). Sem ele, responde 503. */
  INGEST_TOKEN?: string;
  /** Se definido, a leitura da API (painel/TV) exige este token. Só permite ler. */
  VIEW_TOKEN?: string;

  /** Credencial do app de desenvolvedor pessoal eWeLink (dev.ewelink.cc). */
  EWELINK_APP_ID?: string;
  EWELINK_APP_SECRET?: string;
  /** URL de retorno cadastrada no app eWeLink: https://<seu-endereço>/api/ewelink/callback */
  EWELINK_REDIRECT_URL?: string;
  /** Opcional (AAAA-MM-DD): data em que a credencial pessoal (válida 1 ano) vence, para aviso antecipado. */
  EWELINK_APP_EXPIRES_AT?: string;
  /** SOMENTE PARA TESTES AUTOMATIZADOS: aponta para um servidor local que imita a API. Nunca defina em produção. */
  EWELINK_API_BASE_OVERRIDE?: string;
  EWELINK_OAUTH_URL_OVERRIDE?: string;
}
