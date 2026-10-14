import type { HistoryResponse, HistorySeries } from '@orq/core';
import { DAY } from '@orq/core';
import { api } from './api';

/** Busca leituras brutas em janelas de até 48 h (limite da API) e junta os resultados (exportação CSV). */
export async function fetchRawChunked(
  from: number,
  to: number,
  opts: { full?: boolean; signal?: AbortSignal; onProgress?: (done: number, total: number) => void } = {},
): Promise<HistoryResponse> {
  const chunkMs = 2 * DAY;
  const total = Math.max(1, Math.ceil((to - from) / chunkMs));
  const bySensor = new Map<string, Map<number, (number | null)[]>>();
  let truncated = false;
  for (let i = 0; i < total; i++) {
    const a = from + i * chunkMs;
    const b = Math.min(to, a + chunkMs);
    const h = await api.history(a, b, { res: 'raw', full: opts.full, signal: opts.signal });
    truncated ||= h.truncated;
    for (const s of h.series) {
      let m = bySensor.get(s.sensorId);
      if (!m) bySensor.set(s.sensorId, (m = new Map()));
      for (const r of s.rows) m.set(r[0] as number, r); // limites inclusivos: deduplica por instante
    }
    opts.onProgress?.(i + 1, total);
  }
  const series: HistorySeries[] = [...bySensor.entries()].map(([sensorId, m]) => ({ sensorId, rows: [...m.values()].sort((x, y) => (x[0] as number) - (y[0] as number)) }));
  return { from: new Date(from).toISOString(), to: new Date(to).toISOString(), resolution: 'raw', detail: opts.full ? 'full' : 'basic', series, truncated };
}
