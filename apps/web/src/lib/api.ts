import type { AppConfig, HistoryResponse, LiveResponse, ProviderDeviceDto } from '@orq/core';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

const VIEW_KEY = 'orq.viewToken';
const ADMIN_KEY = 'orq.adminToken';

function safeGet(store: Storage | undefined, key: string): string | null {
  try {
    return store?.getItem(key) ?? null;
  } catch {
    return null;
  }
}
function safeSet(store: Storage | undefined, key: string, value: string | null) {
  try {
    if (value === null) store?.removeItem(key);
    else store?.setItem(key, value);
  } catch {
    /* armazenamento indisponível: segue sem persistir */
  }
}

/** Token de visualização: ?k= na URL (favorito da TV) > armazenado neste dispositivo. */
export function getViewToken(): string | null {
  const fromUrl = new URLSearchParams(location.search).get('k');
  if (fromUrl) {
    safeSet(localStorage, VIEW_KEY, fromUrl);
    return fromUrl;
  }
  return safeGet(localStorage, VIEW_KEY);
}
export function setViewToken(t: string | null) {
  safeSet(localStorage, VIEW_KEY, t);
}

/** Token de administração: por padrão só na sessão da aba; "lembrar" guarda neste dispositivo. */
export function getAdminToken(): string | null {
  return safeGet(sessionStorage, ADMIN_KEY) ?? safeGet(localStorage, ADMIN_KEY);
}
export function setAdminToken(t: string | null, remember: boolean) {
  safeSet(sessionStorage, ADMIN_KEY, null);
  safeSet(localStorage, ADMIN_KEY, null);
  if (t) safeSet(remember ? localStorage : sessionStorage, ADMIN_KEY, t);
}

async function request<T>(path: string, init: { method?: string; body?: unknown; admin?: boolean; signal?: AbortSignal } = {}): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json' };
  const view = getViewToken();
  if (view) headers['x-view-token'] = view;
  if (init.admin) {
    const admin = getAdminToken();
    if (admin) headers.authorization = `Bearer ${admin}`;
  }
  if (init.body !== undefined) headers['content-type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(path, {
      method: init.method ?? 'GET',
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: init.signal,
      cache: 'no-store',
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ApiError(0, 'network', 'Sem conexão com o servidor.');
  }
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* corpo não-JSON */
  }
  if (!res.ok) {
    const err = (json as { error?: { code?: string; message?: string } } | null)?.error;
    throw new ApiError(res.status, err?.code ?? 'http_' + res.status, err?.message ?? `Erro ${res.status}`);
  }
  return json as T;
}

export interface Meta {
  viewProtected: boolean;
  writeAuthConfigured: boolean;
  ingestAuthConfigured: boolean;
}

export const api = {
  meta: (signal?: AbortSignal) => request<Meta>('/api/meta', { signal }),
  live: (signal?: AbortSignal) => request<LiveResponse>('/api/live', { signal }),
  history: (from: number, to: number, opts: { res?: 'auto' | 'raw' | 'hourly'; full?: boolean; signal?: AbortSignal } = {}) =>
    request<HistoryResponse>(
      `/api/history?from=${encodeURIComponent(new Date(from).toISOString())}&to=${encodeURIComponent(new Date(to).toISOString())}&res=${opts.res ?? 'auto'}${opts.full ? '&detail=full' : ''}`,
      { signal: opts.signal },
    ),
  saveConfig: (config: AppConfig) => request<AppConfig>('/api/config', { method: 'PUT', body: config, admin: true }),
  ewelinkDevices: (signal?: AbortSignal) => request<{ devices: ProviderDeviceDto[] }>('/api/ewelink/devices', { signal }),
  ewelinkAuthorize: () => request<{ url: string }>('/api/ewelink/authorize', { method: 'POST', body: {}, admin: true }),
  ewelinkPoll: () => request<{ ran: boolean; reason?: string; devices?: number; inserted?: number }>('/api/ewelink/poll', { method: 'POST', body: {}, admin: true }),
  ewelinkDisconnect: () => request<{ ok: boolean }>('/api/ewelink/disconnect', { method: 'POST', body: {}, admin: true }),
};
