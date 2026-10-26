import { useEffect, useState } from 'react';
import { formatDateTime } from '@orq/core';
import type { AutomationLogEntryDto } from '@orq/core';
import { ApiError, api } from '../lib/api';
import { Chip } from './ui';

const ACTION = { on: 'Ligou a bomba', off: 'Desligou a bomba', inching: 'Configurou o desligamento automático' } as const;

/** Ações da automação da bomba no intervalo escolhido na página Histórico. */
export function AutomationHistory({ range }: { range: { from: number; to: number } | null }) {
  const [entries, setEntries] = useState<AutomationLogEntryDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const from = range?.from;
  const to = range?.to;
  useEffect(() => {
    if (from === undefined || to === undefined) return;
    const ac = new AbortController();
    setError(null);
    api
      .automationLog(from, to, ac.signal)
      .then((r) => setEntries(r.entries))
      .catch((e) => {
        if ((e as Error).name !== 'AbortError') setError(e instanceof ApiError ? e.message : String(e));
      });
    return () => ac.abort();
  }, [from, to]);

  const failed = entries?.filter((e) => !e.ok).length ?? 0;
  return (
    <section className="card">
      <div className="card__head">
        <div>
          <h2 className="card__title">Ações automáticas</h2>
          <div className="card__sub">Tudo o que o sistema fez sozinho com a bomba, com o motivo e se o Sonoff aceitou.</div>
        </div>
        {entries && <Chip kind={failed ? 'warn' : 'plain'}>{failed ? `${failed} falha(s)` : entries.length}</Chip>}
      </div>
      {error && <div className="empty">{error}</div>}
      {entries && entries.length === 0 && <div className="empty">Nenhuma ação automática no período.</div>}
      {entries && entries.length > 0 && (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Quando</th>
                <th>Ação</th>
                <th>Motivo</th>
                <th>Resultado</th>
              </tr>
            </thead>
            <tbody>
              {entries.slice(0, 300).map((e, i) => (
                <tr key={`${e.at}-${i}`}>
                  <td className="mono">{formatDateTime(Date.parse(e.at))}</td>
                  <td>{ACTION[e.action]}</td>
                  <td>{e.reason}</td>
                  <td>{e.ok ? <Chip kind="ok">ok</Chip> : <span style={{ color: 'var(--red)' }}>falhou: {e.error}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
