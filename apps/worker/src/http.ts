import type { Dataset } from '@orq/core';
import type { Env } from './env';

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

/** Comparação em tempo constante (evita vazar o tamanho do prefixo correto por diferença de tempo). */
export function safeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

export function demoEnabled(env: Env): boolean {
  return env.DEMO_ENABLED !== 'false';
}

export function resolveDataset(env: Env, requested: string | undefined): Dataset {
  const fallback = env.DEFAULT_DATASET === 'real' || !demoEnabled(env) ? 'real' : 'demo';
  const ds = requested ?? fallback;
  if (ds !== 'demo' && ds !== 'real') throw new HttpError(400, 'invalid_dataset', 'dataset deve ser "demo" ou "real".');
  if (ds === 'demo' && !demoEnabled(env)) throw new HttpError(404, 'demo_disabled', 'O modo demonstração está desativado neste ambiente.');
  return ds;
}
