import { useEffect, useState } from 'react';
import { formatDateTime, formatIrrigationDuration, formatTime, irrigationsByDay, startOfLocalDay, toCsv, utcToLocalInput } from '@orq/core';
import type { IrrigationsResponse } from '@orq/core';
import { ApiError, api } from '../lib/api';
import { downloadText } from '../lib/derive';
import { Chip } from './ui';

/** Histórico de irrigações (períodos com a bomba ligada) no intervalo escolhido na página Histórico. */
export function IrrigationHistory({ range, nowMs }: { range: { from: number; to: number } | null; nowMs: number }) {
  const [data, setData] = useState<IrrigationsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const from = range?.from;
  const to = range?.to;
  useEffect(() => {
    if (from === undefined || to === undefined) return;
    const ac = new AbortController();
    setError(null);
    api
      .irrigations(from, to, ac.signal)
      .then(setData)
      .catch((e) => {
        if ((e as Error).name !== 'AbortError') setError(e instanceof ApiError ? e.message : String(e));
      });
    return () => ac.abort();
  }, [from, to]);

  const events = data?.events ?? [];
  const days = irrigationsByDay(events, (ms) => startOfLocalDay(ms));
  const total = events.reduce((s, e) => s + e.durationMs, 0);
  const exportCsv = () => {
    const rows = events.map((e) => [
      e.startedAt,
      utcToLocalInput(Date.parse(e.startedAt)).replace('T', ' '),
      e.endedAt ?? '',
      e.endedAt ? utcToLocalInput(Date.parse(e.endedAt)).replace('T', ' ') : '',
      Math.round(e.durationMs / 60000),
      e.endedAt === null ? 'em andamento' : e.endReason === 'sem_sinal' ? 'fim sem sinal do Sonoff' : '',
    ]);
    downloadText(
      `irrigacoes_${utcToLocalInput(from ?? nowMs).slice(0, 10)}_${utcToLocalInput(to ?? nowMs).slice(0, 10)}.csv`,
      toCsv(['inicio_utc', 'inicio_america_sao_paulo', 'fim_utc', 'fim_america_sao_paulo', 'duracao_min', 'observacao'], rows),
    );
  };

  return (
    <section className="card" aria-label="Irrigações">
      <div className="card__head">
        <div>
          <h2 className="card__title">Irrigações</h2>
          <div className="card__sub">Períodos em que o Sonoff da bomba foi visto ligado. Início e fim com precisão de ~2 min; irrigações mais curtas que isso podem não aparecer.</div>
        </div>
        <Chip kind="plain">{events.length}</Chip>
      </div>
      {error && <div className="notice notice--bad small">Não foi possível carregar: {error}</div>}
      {data && events.length === 0 && <div className="empty">Nenhuma irrigação registrada no período.</div>}
      {events.length > 0 && (
        <>
          <div className="kpi-grid" style={{ marginBottom: '0.8rem' }}>
            <div>
              <div className="tiny mute">Irrigações no período</div>
              <b>{events.length}</b>
            </div>
            <div>
              <div className="tiny mute">Tempo total ligada</div>
              <b>{formatIrrigationDuration(total)}</b>
            </div>
            <div>
              <div className="tiny mute">Duração média</div>
              <b>{formatIrrigationDuration(total / events.length)}</b>
            </div>
            <div>
              <div className="tiny mute">Média por dia (dias com irrigação)</div>
              <b>
                {(events.length / days.length).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} × · {formatIrrigationDuration(total / days.length)}
              </b>
            </div>
          </div>
          <div className="split">
            <div className="table-wrap" style={{ maxHeight: '22rem', overflowY: 'auto' }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Dia</th>
                    <th className="num">Irrigações</th>
                    <th className="num">Tempo total</th>
                  </tr>
                </thead>
                <tbody>
                  {days.map((d) => (
                    <tr key={d.dayStart}>
                      <td>{formatDateTime(d.dayStart + 12 * 3600_000).slice(0, 10)}</td>
                      <td className="num">{d.count}</td>
                      <td className="num">{formatIrrigationDuration(d.totalMs)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="table-wrap" style={{ maxHeight: '22rem', overflowY: 'auto' }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Início</th>
                    <th>Fim</th>
                    <th className="num">Duração</th>
                  </tr>
                </thead>
                <tbody>
                  {events.slice(0, 300).map((e) => (
                    <tr key={e.startedAt}>
                      <td>{formatDateTime(Date.parse(e.startedAt))}</td>
                      <td>
                        {e.endedAt === null ? <Chip kind="ok">em andamento</Chip> : formatTime(Date.parse(e.endedAt))}
                        {e.endReason === 'sem_sinal' && (
                          <span className="tiny" style={{ color: 'var(--amber)' }}>
                            {' '}
                            (sem sinal)
                          </span>
                        )}
                      </td>
                      <td className="num">{formatIrrigationDuration(e.durationMs)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="toolbar" style={{ marginTop: '0.6rem' }}>
            <button type="button" className="btn btn--sm" onClick={exportCsv}>
              ⬇ Exportar irrigações (CSV)
            </button>
            {data?.truncated && <span className="tiny" style={{ color: 'var(--amber)' }}>Mostrando as 2000 mais recentes do período.</span>}
          </div>
        </>
      )}
    </section>
  );
}
