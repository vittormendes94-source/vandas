import { useEffect, useState } from 'react';
import type { HistoryResponse } from '@orq/core';
import { ApiError, api } from '../lib/api';

export interface HistoryState {
  data: HistoryResponse | null;
  loading: boolean;
  error: ApiError | null;
}

/** Carrega um intervalo (a API escolhe bruto ≤ 48 h, horário acima). `key` força recarregar. */
export function useHistory(range: { from: number; to: number } | null, key = 0): HistoryState {
  const [state, setState] = useState<HistoryState>({ data: null, loading: !!range, error: null });
  const from = range?.from;
  const to = range?.to;
  useEffect(() => {
    if (from === undefined || to === undefined) {
      setState({ data: null, loading: false, error: null });
      return;
    }
    const ac = new AbortController();
    setState((s) => ({ ...s, loading: true, error: null }));
    api
      .history(from, to, { signal: ac.signal })
      .then((data) => setState({ data, loading: false, error: null }))
      .catch((e) => {
        if ((e as Error).name === 'AbortError') return;
        setState({ data: null, loading: false, error: e instanceof ApiError ? e : new ApiError(0, 'unknown', String(e)) });
      });
    return () => ac.abort();
  }, [from, to, key]);
  return state;
}
