import type { Context, Next } from 'hono';
import type { Env } from './env';
import { HttpError, safeEqual } from './http';

type Ctx = Context<{ Bindings: Env }>;

function bearer(c: Ctx): string | null {
  const h = c.req.header('authorization');
  const m = h ? /^Bearer\s+(.+)$/i.exec(h) : null;
  return m ? m[1]!.trim() : null;
}

/**
 * Acesso de VISUALIZAÇÃO (TV, celular). Se VIEW_TOKEN estiver definido, exige-o; o token de visualização
 * só permite leitura — não dá acesso a configuração nem a ingestão. Tokens de admin também servem para ler.
 * O token pode vir em Authorization: Bearer, x-view-token ou ?k= (este para favoritar a URL da TV).
 */
export async function requireView(c: Ctx, next: Next) {
  const expected = c.env.VIEW_TOKEN;
  if (!expected) return next();
  const given = bearer(c) ?? c.req.header('x-view-token') ?? c.req.query('k') ?? '';
  const ok = safeEqual(given, expected) || (!!c.env.ADMIN_TOKEN && safeEqual(given, c.env.ADMIN_TOKEN));
  if (!ok) throw new HttpError(401, 'view_token_required', 'Token de visualização ausente ou inválido.');
  return next();
}

/** Gravação de configuração: exige ADMIN_TOKEN em Authorization: Bearer (nunca em query string). */
export async function requireAdmin(c: Ctx, next: Next) {
  const expected = c.env.ADMIN_TOKEN;
  if (!expected) throw new HttpError(503, 'admin_not_configured', 'ADMIN_TOKEN não está configurado; a gravação de configuração está desativada.');
  if (!safeEqual(bearer(c) ?? '', expected)) throw new HttpError(401, 'admin_token_required', 'Token de administração ausente ou inválido.');
  return next();
}

/** Ingestão de medições: exige INGEST_TOKEN em Authorization: Bearer. */
export async function requireIngest(c: Ctx, next: Next) {
  const expected = c.env.INGEST_TOKEN;
  if (!expected) throw new HttpError(503, 'ingest_not_configured', 'INGEST_TOKEN não está configurado; a ingestão está desativada.');
  if (!safeEqual(bearer(c) ?? '', expected)) throw new HttpError(401, 'ingest_token_required', 'Token de ingestão ausente ou inválido.');
  return next();
}
