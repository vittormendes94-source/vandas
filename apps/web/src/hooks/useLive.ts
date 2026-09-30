import { useCallback, useEffect, useRef, useState } from 'react';
import type { Dataset, LiveResponse } from '@orq/core';
import { ApiError, api } from '../lib/api';

export interface LiveState {
  dataset: Dataset;
  data: LiveResponse | null;
  /** Relógio LOCAL no momento em que a última resposta chegou (para estimar o "agora" do servidor). */
  fetchedAtLocal: number | null;
  error: ApiError | null;
  failures: number;
  loading: boolean;
  /** Quando ocorrerá a próxima tentativa (relógio local). */
  nextAtLocal: number | null;
}

const MAX_BACKOFF_MS = 300_000;

/**
 * Polling do estado atual com recuo exponencial em falhas e pausa com a aba oculta.
 * O polling só renova a *tela*: a idade de cada leitura vem do instante da medição (ver useServerNow).
 * Atualização por eventos (SSE/WebSocket) exigiria conexões longas ou Durable Objects; ver docs/CUSTOS-E-COTAS.md.
 */
export function useLive(dataset: Dataset, baseSeconds: number): LiveState & { refresh: () => void } {
  const [state, setState] = useState<LiveState>({ dataset, data: null, fetchedAtLocal: null, error: null, failures: 0, loading: true, nextAtLocal: null });
  const failures = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const controller = useRef<AbortController | null>(null);
  const runRef = useRef<() => void>(() => {});

  useEffect(() => {
    failures.current = 0;
    setState({ dataset, data: null, fetchedAtLocal: null, error: null, failures: 0, loading: true, nextAtLocal: null });
    let cancelled = false;

    const schedule = () => {
      if (cancelled) return;
      const base = baseSeconds * 1000;
      const delay = Math.min(base * 2 ** failures.current, MAX_BACKOFF_MS) * (0.9 + Math.random() * 0.2);
      setState((s) => (s.dataset === dataset ? { ...s, nextAtLocal: Date.now() + delay } : s));
      timer.current = setTimeout(run, delay);
    };

    const run = async () => {
      if (cancelled) return;
      if (timer.current) clearTimeout(timer.current);
      if (document.visibilityState === 'hidden') return schedule();
      controller.current?.abort();
      const ac = new AbortController();
      controller.current = ac;
      setState((s) => (s.dataset === dataset ? { ...s, loading: true } : s));
      try {
        const data = await api.live(dataset, ac.signal);
        if (cancelled) return;
        failures.current = 0;
        setState({ dataset, data, fetchedAtLocal: Date.now(), error: null, failures: 0, loading: false, nextAtLocal: null });
      } catch (e) {
        if (cancelled || (e as Error).name === 'AbortError') return;
        failures.current += 1;
        const err = e instanceof ApiError ? e : new ApiError(0, 'unknown', String(e));
        setState((s) => (s.dataset === dataset ? { ...s, error: err, failures: failures.current, loading: false } : s));
        // 401/404: repetir não resolve; segue com recuo máximo para não martelar o servidor.
        if (err.status === 401 || err.status === 404) failures.current = Math.max(failures.current, 6);
      }
      schedule();
    };
    runRef.current = run;

    const onVisible = () => {
      if (document.visibilityState === 'visible') run();
    };
    document.addEventListener('visibilitychange', onVisible);
    run();
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      if (timer.current) clearTimeout(timer.current);
      controller.current?.abort();
    };
  }, [dataset, baseSeconds]);

  const refresh = useCallback(() => {
    failures.current = 0;
    runRef.current();
  }, []);
  return { ...state, refresh };
}

/**
 * "Agora" estimado a partir da hora do SERVIDOR + tempo decorrido localmente desde a resposta.
 * Assim, a idade das leituras cresce com o relógio e NUNCA é renovada por atualizar a tela;
 * e o relógio do dispositivo (que pode estar errado, como o de uma TV) não distorce as idades.
 */
export function useServerNow(live: Pick<LiveState, 'data' | 'fetchedAtLocal'>, tickMs = 15_000): number {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), tickMs);
    return () => clearInterval(id);
  }, [tickMs]);
  if (live.data && live.fetchedAtLocal !== null) return Date.parse(live.data.serverTime) + (Date.now() - live.fetchedAtLocal);
  return Date.now();
}
