import type { Env } from './env';

/** Remove segredos conhecidos e padrões de credencial antes de qualquer log. */
export function redact(text: string, env?: Partial<Env>): string {
  let out = text
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, '$1[REDIGIDO]')
    .replace(/([?&](?:k|token|password|senha|secret)=)[^&\s]+/gi, '$1[REDIGIDO]')
    .replace(/("(?:password|senha|token|secret|authorization)"\s*:\s*")[^"]*(")/gi, '$1[REDIGIDO]$2');
  for (const secret of [env?.VIEW_TOKEN, env?.ADMIN_TOKEN, env?.INGEST_TOKEN, env?.EWELINK_APP_SECRET, env?.EWELINK_APP_ID]) {
    if (secret && secret.length >= 6) out = out.split(secret).join('[REDIGIDO]');
  }
  return out;
}

export function logError(scope: string, err: unknown, env?: Partial<Env>, extra?: Record<string, unknown>): void {
  const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  console.error(JSON.stringify({ level: 'error', scope, message: redact(msg, env), ...extra }));
}

export function logInfo(scope: string, message: string, extra?: Record<string, unknown>): void {
  console.log(JSON.stringify({ level: 'info', scope, message, ...extra }));
}
