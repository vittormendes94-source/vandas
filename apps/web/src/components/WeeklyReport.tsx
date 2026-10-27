import { useEffect, useState } from 'react';
import { HOUR, activeAlerts, irrigationResponse, responseAdvice, bucketsFromHistory, fmtNum, formatIrrigationDuration, weeklyInsights } from '@orq/core';
import type { AppConfig, AutomationLogEntryDto, Bucket, IrrigationsResponse } from '@orq/core';
import { api } from '../lib/api';

interface Data {
  buckets: Bucket[];
  raw: Map<string, { t: number; h: number }[]>;
  irr: IrrigationsResponse;
  log: AutomationLogEntryDto[];
}

/** Relatório dos últimos 7 dias, calculado na hora a partir das médias por hora (nada é gravado). */
export function WeeklyReport({ config, nowMs }: { config: AppConfig; nowMs: number }) {
  const [d, setD] = useState<Data | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const to = Math.floor(nowMs / HOUR) * HOUR;
  const from = to - 7 * 24 * HOUR;
  useEffect(() => {
    const ac = new AbortController();
    Promise.all([
      api.history(from, to, { res: 'hourly', signal: ac.signal }),
      api.irrigations(from, to, ac.signal),
      api.automationLog(from, to, ac.signal),
      api.history(to - 48 * HOUR, to, { res: 'raw', signal: ac.signal }),
    ])
      .then(([h, irr, log, raw]) => {
        const m = new Map<string, { t: number; h: number }[]>();
        for (const se of raw.series) m.set(se.sensorId, se.rows.map((r) => ({ t: r[0] as number, h: r[2] as number })));
        setD({ buckets: bucketsFromHistory(h), irr, log: log.entries, raw: m });
      })
      .catch((e) => (e as Error).name !== 'AbortError' && setErr((e as Error).message));
    return () => ac.abort();
  }, [from, to]);

  const name = (id: string) => config.sensors.find((s) => s.id === id)?.name ?? id;
  const stat = (q: 'temperature' | 'humidity') => {
    if (!d || d.buckets.length === 0) return null;
    const avg = (b: Bucket) => (q === 'temperature' ? b.tAvg : b.hAvg);
    const mn = d.buckets.reduce((a, b) => ((q === 'temperature' ? b.tMin : b.hMin) < (q === 'temperature' ? a.tMin : a.hMin) ? b : a));
    const mx = d.buckets.reduce((a, b) => ((q === 'temperature' ? b.tMax : b.hMax) > (q === 'temperature' ? a.tMax : a.hMax) ? b : a));
    const mean = d.buckets.reduce((s, b) => s + avg(b), 0) / d.buckets.length;
    const lim = config.alerts[q];
    const out = (b: Bucket) => {
      const l = activeAlerts(config, b.t)[q];
      return (l.min !== null && avg(b) < l.min) || (l.max !== null && avg(b) > l.max);
    };
    const hours = new Set(d.buckets.filter(out).map((b) => b.t)).size;
    const bySensor = new Map<string, number[]>();
    for (const b of d.buckets) bySensor.set(b.sensorId, [...(bySensor.get(b.sensorId) ?? []), avg(b)]);
    const means = [...bySensor].map(([id, v]) => ({ id, m: v.reduce((a, x) => a + x, 0) / v.length })).sort((a, b) => b.m - a.m);
    return { min: q === 'temperature' ? mn.tMin : mn.hMin, minAt: mn.t, max: q === 'temperature' ? mx.tMax : mx.hMax, maxAt: mx.t, mean, hours, limits: lim.min !== null || lim.max !== null, top: means[0], bottom: means[means.length - 1] };
  };
  const dt = (t: number) => new Date(t).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  const peakHours = () => {
    if (!d) return [];
    const acc = new Map<string, Map<number, number[]>>();
    for (const b of d.buckets) {
      const h = Number(new Date(b.t).toLocaleString('en-US', { timeZone: 'America/Sao_Paulo', hour: '2-digit', hourCycle: 'h23' }));
      const m = acc.get(b.sensorId) ?? new Map<number, number[]>();
      m.set(h, [...(m.get(h) ?? []), b.tAvg]);
      acc.set(b.sensorId, m);
    }
    return [...acc].map(([id, m]) => {
      const best = [...m].map(([hour, v]) => ({ hour, v: v.reduce((a, x) => a + x, 0) / v.length })).reduce((a, b) => (b.v > a.v ? b : a));
      return { id, ...best };
    });
  };
  const t = stat('temperature');
  const h = stat('humidity');
  const ev = d?.irr.events ?? [];
  const total = ev.reduce((s, e) => s + e.durationMs, 0);
  const autoOn = d?.log.filter((x) => x.action === 'on' && x.ok).length ?? 0;
  const autoOff = d?.log.filter((x) => x.action === 'off' && x.ok).length ?? 0;
  const fails = d?.log.filter((x) => !x.ok).length ?? 0;

  return (
    <section className="card report">
      <div className="card__head">
        <div>
          <h2 className="card__title">Relatório da semana</h2>
          <div className="card__sub">Últimos 7 dias, calculado agora a partir das médias por hora.</div>
        </div>
        <button type="button" className="btn btn--sm hide-print" onClick={() => window.print()}>
          Imprimir / PDF
        </button>
      </div>
      {err && <div className="empty">{err}</div>}
      {!d && !err && <div className="empty">Calculando…</div>}
      {d && (
        <div className="report__todo">
          <h3>O que fazer</h3>
          {!(config.alerts.temperature.min ?? config.alerts.temperature.max ?? config.alerts.humidity.min ?? config.alerts.humidity.max) ? (
            <p className="mute">Defina as faixas ideais em Configurações para receber recomendações.</p>
          ) : (
            <ul>
              {weeklyInsights(d.buckets, config).map((x, i) => (
                <li key={i} className={`report__todo-${x.level}`}>
                  <b>{x.title}.</b> {x.action}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {d && (
        <div className="report__grid">
          {[
            ['Temperatura', t, '°C', 1],
            ['Umidade', h, '%', 0],
          ].map(([label, s, unit, dig]) => {
            const st = s as ReturnType<typeof stat>;
            return (
              <div key={label as string} className="report__box">
                <h3>{label as string}</h3>
                {!st ? (
                  <p className="mute">Sem dados no período.</p>
                ) : (
                  <ul>
                    <li>
                      Média <b>{fmtNum(st.mean, dig as number)} {unit as string}</b>
                    </li>
                    <li>
                      Mínima <b>{fmtNum(st.min, dig as number)} {unit as string}</b> · {dt(st.minAt)}
                    </li>
                    <li>
                      Máxima <b>{fmtNum(st.max, dig as number)} {unit as string}</b> · {dt(st.maxAt)}
                    </li>
                    <li>{st.limits ? <>Fora da faixa: <b>{st.hours} h</b></> : <span className="mute">Defina a faixa ideal para contar horas fora dela.</span>}</li>
                    {st.top && st.bottom && st.top.id !== st.bottom.id && (
                      <li>
                        Ponto mais {label === 'Temperatura' ? 'quente' : 'úmido'}: <b>{name(st.top.id)}</b> · menos: <b>{name(st.bottom.id)}</b>
                      </li>
                    )}
                  </ul>
                )}
              </div>
            );
          })}
          <div className="report__box">
            <h3>Sol e calor por ponto</h3>
            <ul>
              {peakHours().map((x) => (
                <li key={x.id}>
                  <b>{name(x.id)}</b>: mais quente por volta das <b>{x.hour}h</b> ({fmtNum(x.v, 1)} °C em média)
                </li>
              ))}
              {peakHours().length === 0 && <li className="mute">Sem dados suficientes ainda.</li>}
            </ul>
            <p className="small mute" style={{ margin: '0.3rem 0 0' }}>Pontos que esquentam de manhã recebem sol do leste; à tarde, do oeste.</p>
          </div>
          <div className="report__box">
            <h3>Depois de cada irrigação (raízes)</h3>
            {(() => {
              const r = irrigationResponse(ev.filter((e) => Date.parse(e.startedAt) >= to - 48 * HOUR), d.raw);
              if (!r.length) return <p className="mute">Aparece quando houver irrigações registradas nas últimas 48 h (precisa da bomba conectada).</p>;
              return (
                <ul>
                  {r.map((x) => (
                    <li key={x.sensorId}>
                      <b>{name(x.sensorId)}</b>: sobe <b>{x.rise} {x.rise === 1 ? 'ponto' : 'pontos'}</b>, volta ao normal em <b>{x.recoverMin === null ? 'mais de 12 h' : x.recoverMin >= 60 ? `${Math.floor(x.recoverMin / 60)} h ${String(x.recoverMin % 60).padStart(2, '0')}` : `${x.recoverMin} min`}</b>
                      <br />
                      <span className="small mute">{responseAdvice(x)}</span>
                    </li>
                  ))}
                </ul>
              );
            })()}
          </div>
          <div className="report__box">
            <h3>Irrigação</h3>
            <ul>
              <li>
                Irrigações <b>{ev.length}</b> · tempo total <b>{ev.length ? formatIrrigationDuration(total) : '0 min'}</b>
              </li>
              <li>
                Ligadas pelo sistema <b>{autoOn}</b> · desligadas pelo sistema <b>{autoOff}</b>
              </li>
              <li>{fails ? <b style={{ color: 'var(--red)' }}>{fails} comando(s) falharam</b> : 'Nenhuma falha de comando'}</li>
            </ul>
          </div>
        </div>
      )}
    </section>
  );
}
