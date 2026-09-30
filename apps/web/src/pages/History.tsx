import { useMemo, useState } from 'react';
import {
  DAY,
  MIN,
  bucketsFromHistory,
  buildSnapshot,
  compareAroundEvents,
  dewPointC,
  findGaps,
  fmtNum,
  formatDateTime,
  formatDuration,
  groupBySensor,
  localInputToUtc,
  periodFromDto,
  readingsFromFullHistory,
  summarizePeriod,
  toCsv,
  utcToLocalInput,
  vpdKpa,
} from '@orq/core';
import type { AppConfig, Dataset, EventComparison } from '@orq/core';
import { LineChart } from '../components/LineChart';
import type { ChartSeries } from '../components/LineChart';
import { PeriodCard } from '../components/Indicators';
import { CalcChip, Chip, Notice, OriginChip } from '../components/ui';
import { useHistory } from '../hooks/useHistory';
import { api } from '../lib/api';
import { SERIES_COLORS } from '../lib/colors';
import { bucketToReading, downloadText } from '../lib/derive';
import { fetchRawChunked } from '../lib/history';

type Preset = '24h' | '7d' | '30d' | 'custom';
const PRESETS: [Preset, string, number][] = [
  ['24h', 'Últimas 24 horas', DAY],
  ['7d', '7 dias', 7 * DAY],
  ['30d', '30 dias', 30 * DAY],
];

const stamp = (ms: number) => utcToLocalInput(ms).replace(/[-:T]/g, '').slice(0, 12);

export function History({ dataset, config, nowMs }: { dataset: Dataset; config: AppConfig | null; nowMs: number }) {
  const [preset, setPreset] = useState<Preset>('24h');
  const [customFrom, setCustomFrom] = useState(() => utcToLocalInput(nowMs - 3 * DAY));
  const [customTo, setCustomTo] = useState(() => utcToLocalInput(nowMs));
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [reload, setReload] = useState(0);
  const [cmp, setCmp] = useState<{ loading: boolean; events: EventComparison[] | null; error: string | null }>({ loading: false, events: null, error: null });
  const [exp, setExp] = useState<{ busy: boolean; msg: string | null }>({ busy: false, msg: null });

  const anchor = Math.floor(nowMs / (5 * MIN)) * (5 * MIN);
  const { range, rangeError } = useMemo(() => {
    if (preset !== 'custom') {
      const span = PRESETS.find((p) => p[0] === preset)![2];
      return { range: { from: anchor - span, to: anchor }, rangeError: null as string | null };
    }
    const f = localInputToUtc(customFrom);
    const t = localInputToUtc(customTo);
    if (f === null || t === null) return { range: null, rangeError: 'Informe início e fim válidos.' };
    if (t <= f) return { range: null, rangeError: 'O fim deve ser posterior ao início.' };
    if (t - f > 400 * DAY) return { range: null, rangeError: 'Intervalo máximo: 400 dias.' };
    return { range: { from: f, to: t }, rangeError: null };
  }, [preset, anchor, customFrom, customTo]);

  const hist = useHistory(dataset, range, reload);
  const buckets = useMemo(() => (hist.data ? bucketsFromHistory(hist.data) : []), [hist.data]);
  const hourly = hist.data?.resolution === 'hourly';
  const periods = useMemo(() => (hist.data ? hist.data.irrigation.map(periodFromDto) : []), [hist.data]);

  const sensors = config?.sensors ?? [];
  const colorOf = (id: string) => SERIES_COLORS[Math.max(0, sensors.findIndex((s) => s.id === id)) % SERIES_COLORS.length]!;
  const nameOf = (id: string) => sensors.find((s) => s.id === id)?.name ?? id;

  const { tSeries, hSeries } = useMemo(() => {
    const per = groupBySensor(buckets, (b) => b.t);
    const mk = (pick: 'temperature' | 'humidity'): ChartSeries[] =>
      sensors
        .filter((s) => !hidden.has(s.id))
        .map((s) => ({
          id: s.id,
          name: `${s.id.toUpperCase()} · ${s.name}`,
          color: colorOf(s.id),
          points: (per.get(s.id) ?? []).map((b) =>
            pick === 'temperature' ? { t: b.t, v: b.tAvg, lo: hourly ? b.tMin : undefined, hi: hourly ? b.tMax : undefined } : { t: b.t, v: b.hAvg, lo: hourly ? b.hMin : undefined, hi: hourly ? b.hMax : undefined },
          ),
        }));
    return { tSeries: mk('temperature'), hSeries: mk('humidity') };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buckets, sensors, hidden, hourly]);

  const gapMs = (hourly ? 90 : config?.freshness.freshMaxMin ?? 15) * MIN;
  const gaps = useMemo(() => {
    const per = groupBySensor(buckets, (b) => b.t);
    return [...per.entries()].flatMap(([id, arr]) => findGaps(arr, id, gapMs)).sort((a, b) => b.to - b.from - (a.to - a.from));
  }, [buckets, gapMs]);
  const summary = useMemo(() => summarizePeriod(buckets.filter((b) => !hidden.has(b.sensorId))), [buckets, hidden]);
  const nameSnapshot = useMemo(() => (config ? buildSnapshot(config, new Map(), nowMs) : null), [config, nowMs]);

  if (!config || !nameSnapshot) return <div className="container"><div className="empty">Carregando…</div></div>;
  const conjunto = dataset === 'demo' ? 'demo (SIMULADO)' : 'real';

  const compare = async () => {
    if (!range) return;
    if (range.to - range.from > 7 * DAY) return setCmp({ loading: false, events: null, error: 'Para comparar, selecione um período de até 7 dias (leituras brutas).' });
    setCmp({ loading: true, events: null, error: null });
    try {
      const W = config.irrigation.comparisonWindowMin * MIN;
      const raw = await fetchRawChunked(dataset, range.from - W, Math.min(anchor + MIN, range.to + W));
      const readings = bucketsFromHistory(raw).map((b) => bucketToReading(b));
      const events = compareAroundEvents(readings, periods.filter((p) => p.startedAt >= range.from), config.sensors.map((s) => s.id), W);
      setCmp({ loading: false, events, error: null });
    } catch (e) {
      setCmp({ loading: false, events: null, error: (e as Error).message });
    }
  };

  const exportReadings = async () => {
    if (!range) return;
    if (range.to - range.from > 31 * DAY) return setExp({ busy: false, msg: 'Leituras brutas: máximo de 31 dias. Use o CSV horário para períodos maiores.' });
    setExp({ busy: true, msg: 'Buscando leituras…' });
    try {
      const raw = await fetchRawChunked(dataset, range.from, range.to, { full: true, onProgress: (d, t) => setExp({ busy: true, msg: `Buscando leituras… ${d}/${t}` }) });
      const rows = readingsFromFullHistory(raw, dataset === 'demo' ? 'demo-simulador' : '').map((r) => [
        conjunto,
        r.sensorId,
        nameOf(r.sensorId),
        new Date(r.measuredAt).toISOString(),
        formatDateTime(r.measuredAt),
        new Date(r.receivedAt).toISOString(),
        r.timeBasis === 'source' ? 'origem' : 'recebimento',
        r.temperatureC,
        r.humidityPct,
        vpdKpa(r.temperatureC, r.humidityPct) === null ? null : Math.round(vpdKpa(r.temperatureC, r.humidityPct)! * 1000) / 1000,
        dewPointC(r.temperatureC, r.humidityPct) === null ? null : Math.round(dewPointC(r.temperatureC, r.humidityPct)! * 100) / 100,
        r.batteryPct,
        r.linkQuality,
        r.rssiDbm,
      ]);
      const csv = toCsv(
        ['conjunto', 'sensor_id', 'sensor_nome', 'medido_em_utc', 'medido_em_america_sao_paulo', 'recebido_em_utc', 'base_do_horario', 'temperatura_c', 'umidade_relativa_pct', 'dpv_ar_kpa', 'ponto_orvalho_c', 'bateria_pct', 'lqi', 'rssi_dbm'],
        rows,
      );
      downloadText(`orquidario_leituras_${dataset}_${stamp(range.from)}_${stamp(range.to)}.csv`, csv);
      setExp({ busy: false, msg: `${rows.length} leituras exportadas${raw.truncated ? ' (atenção: algum trecho foi truncado pelo limite da API)' : ''}.` });
    } catch (e) {
      setExp({ busy: false, msg: `Falha na exportação: ${(e as Error).message}` });
    }
  };

  const exportHourly = async () => {
    if (!range) return;
    setExp({ busy: true, msg: 'Buscando agregado horário…' });
    try {
      const h = await api.history(dataset, range.from, range.to, { res: 'hourly' });
      const rows = bucketsFromHistory(h).map((b) => [conjunto, b.sensorId, nameOf(b.sensorId), new Date(b.t).toISOString(), formatDateTime(b.t), b.tAvg, b.tMin, b.tMax, b.hAvg, b.hMin, b.hMax, b.n]);
      downloadText(
        `orquidario_horario_${dataset}_${stamp(range.from)}_${stamp(range.to)}.csv`,
        toCsv(['conjunto', 'sensor_id', 'sensor_nome', 'hora_utc', 'hora_america_sao_paulo', 'temperatura_media_c', 'temperatura_min_c', 'temperatura_max_c', 'umidade_media_pct', 'umidade_min_pct', 'umidade_max_pct', 'amostras'], rows),
      );
      setExp({ busy: false, msg: `${rows.length} linhas horárias exportadas.` });
    } catch (e) {
      setExp({ busy: false, msg: `Falha na exportação: ${(e as Error).message}` });
    }
  };

  const exportIrrigation = () => {
    const rows = periods.map((p) => [conjunto, new Date(p.startedAt).toISOString(), p.endedAt ? new Date(p.endedAt).toISOString() : null, formatDateTime(p.startedAt), p.endedAt ? formatDateTime(p.endedAt) : null, p.endedAt ? Math.round(((p.endedAt - p.startedAt) / MIN) * 10) / 10 : null, 'ligado observado (estado informado; sem confirmação de vazão)']);
    downloadText(`orquidario_irrigacao_${dataset}_${stamp(range?.from ?? nowMs)}.csv`, toCsv(['conjunto', 'inicio_utc', 'fim_utc', 'inicio_america_sao_paulo', 'fim_america_sao_paulo', 'duracao_min', 'observacao'], rows));
    setExp({ busy: false, msg: `${rows.length} períodos exportados.` });
  };

  return (
    <main className="container">
      <section className="card">
        <div className="card__head">
          <div>
            <h2 className="card__title">Histórico</h2>
            <div className="card__sub">Escolha o período. Até 48 h: leituras brutas; acima disso: médias horárias com faixa mín.–máx. Períodos sem dados ficam em branco, nunca preenchidos.</div>
          </div>
          <div className="toolbar">
            <OriginChip dataset={dataset} />
            {hist.data && <Chip kind="calc">{hourly ? 'Médias horárias' : 'Leituras brutas'}</Chip>}
          </div>
        </div>
        <div className="toolbar" style={{ gap: '0.75rem' }}>
          <div className="seg" role="group" aria-label="Período">
            {PRESETS.map(([id, l]) => (
              <button key={id} type="button" aria-pressed={preset === id} onClick={() => setPreset(id)}>
                {l}
              </button>
            ))}
            <button type="button" aria-pressed={preset === 'custom'} onClick={() => setPreset('custom')}>
              Personalizado
            </button>
          </div>
          {preset === 'custom' && (
            <>
              <label className="field">
                <span>Início (America/Sao_Paulo)</span>
                <input className="input" type="datetime-local" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
              </label>
              <label className="field">
                <span>Fim</span>
                <input className="input" type="datetime-local" value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
              </label>
            </>
          )}
          <button type="button" className="btn btn--sm" onClick={() => setReload((n) => n + 1)}>
            ↻ Recarregar
          </button>
        </div>
        {range && (
          <p className="small dim" style={{ margin: '0.6rem 0 0' }}>
            {formatDateTime(range.from)} → {formatDateTime(range.to)} · {hist.data ? `${buckets.length} ponto(s)` : hist.loading ? 'carregando…' : ''}
          </p>
        )}
        {rangeError && <Notice kind="warn">{rangeError}</Notice>}
        {hist.error && <Notice kind="bad">{hist.error.message}</Notice>}
        {hist.data?.truncated && <Notice kind="warn">O limite de linhas foi atingido; os pontos mais antigos deste intervalo foram omitidos. Reduza o período.</Notice>}
      </section>

      <PeriodCard summary={summary} snapshot={nameSnapshot} periodLabel={PRESETS.find((p) => p[0] === preset)?.[1] ?? 'período personalizado'} resolutionNote={hourly ? 'Baseado em mín./máx. dentro de cada hora.' : undefined} />

      {(
        [
          ['Temperatura por sensor', tSeries, '°C', 1, config.alerts.temperature, 2],
          ['Umidade relativa do ar por sensor', hSeries, '% UR', 0, config.alerts.humidity, 8],
        ] as const
      ).map(([title, series, unit, digits, limits, minSpan]) => (
        <section className="card" key={title} aria-label={title}>
          <div className="card__head">
            <div>
              <h2 className="card__title">{title}</h2>
              <div className="card__sub">{unit === '°C' ? 'Temperatura do ar medida em cada ponto.' : 'Umidade do ar — não é umidade do substrato nem hidratação das raízes.'}</div>
            </div>
            <div className="toolbar">
              <OriginChip dataset={dataset} />
              {config.alerts.demonstrative && (limits.min !== null || limits.max !== null) && <Chip kind="sim">Linhas de limite demonstrativas</Chip>}
            </div>
          </div>
          <div className="chart__legend">
            {sensors.map((s) => (
              <label key={s.id} className="check" style={{ opacity: hidden.has(s.id) ? 0.45 : 1 }}>
                <input
                  type="checkbox"
                  checked={!hidden.has(s.id)}
                  onChange={() =>
                    setHidden((h) => {
                      const n = new Set(h);
                      if (n.has(s.id)) n.delete(s.id);
                      else n.add(s.id);
                      return n;
                    })
                  }
                />
                <span style={{ color: colorOf(s.id) }}>●</span> {s.id.toUpperCase()} · {s.name}
              </label>
            ))}
            <span>
              <i className="band" /> Relé ligado (estado informado)
            </span>
            {hourly && <span className="mute">Faixa clara = mín.–máx. na hora</span>}
            {(limits.min !== null || limits.max !== null) && <span style={{ color: 'var(--amber)' }}>┄ limite configurado</span>}
          </div>
          {range && (
            <LineChart series={series as ChartSeries[]} from={range.from} to={range.to} unit={unit} digits={digits} irrigation={periods} gapMs={gapMs} limits={limits} nowMs={nowMs} minSpan={minSpan} label={title} />
          )}
          {hist.data && buckets.length === 0 && <div className="empty">Nenhuma leitura no período{dataset === 'real' ? ' (modo real: nenhum dado simulado é exibido)' : ''}.</div>}
        </section>
      ))}

      <div className="split">
        <section className="card" aria-label="Lacunas">
          <div className="card__head">
            <div>
              <h2 className="card__title">Lacunas sem leituras</h2>
              <div className="card__sub">Intervalos entre leituras maiores que {formatDuration(gapMs)}. Não são preenchidos nos gráficos.</div>
            </div>
            <Chip kind="warn">{gaps.length}</Chip>
          </div>
          {gaps.length === 0 ? (
            <div className="empty">Nenhuma lacuna no período.</div>
          ) : (
            <div className="table-wrap" style={{ maxHeight: '18rem', overflowY: 'auto' }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Sensor</th>
                    <th>De</th>
                    <th>Até</th>
                    <th className="num">Duração</th>
                  </tr>
                </thead>
                <tbody>
                  {gaps.slice(0, 60).map((g, i) => (
                    <tr key={i}>
                      <td>{g.sensorId.toUpperCase()}</td>
                      <td>{formatDateTime(g.from)}</td>
                      <td>{formatDateTime(g.to)}</td>
                      <td className="num">{formatDuration(g.to - g.from)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="card" aria-label="Eventos de irrigação">
          <div className="card__head">
            <div>
              <h2 className="card__title">Períodos com relé “ligado” observado</h2>
              <div className="card__sub">Estado informado pelo controlador. Sem sensor de vazão: não indica volume aplicado nem água distribuída.</div>
            </div>
            <Chip kind="plain">{periods.length}</Chip>
          </div>
          {periods.length === 0 ? (
            <div className="empty">Nenhum período no intervalo.</div>
          ) : (
            <div className="table-wrap" style={{ maxHeight: '18rem', overflowY: 'auto' }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Início</th>
                    <th>Fim</th>
                    <th className="num">Duração</th>
                  </tr>
                </thead>
                <tbody>
                  {[...periods].reverse().map((p, i) => (
                    <tr key={i}>
                      <td>{formatDateTime(p.startedAt)}</td>
                      <td>{p.endedAt ? formatDateTime(p.endedAt) : <Chip kind="ok">em andamento</Chip>}</td>
                      <td className="num">{p.endedAt ? formatDuration(p.endedAt - p.startedAt) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      <section className="card" aria-label="Comparação antes e depois">
        <div className="card__head">
          <div>
            <h2 className="card__title">Comparação ambiental antes e depois da irrigação</h2>
            <div className="card__sub">
              Variação observada = média nos {config.irrigation.comparisonWindowMin} min depois do fim do período − média nos {config.irrigation.comparisonWindowMin} min antes do início (mín. 2 leituras em cada janela; janelas recortadas se outro evento estiver próximo).
            </div>
          </div>
          <div className="toolbar">
            <CalcChip />
            <button type="button" className="btn btn--sm" disabled={cmp.loading || !range || periods.every((p) => p.endedAt === null)} onClick={compare}>
              {cmp.loading ? 'Calculando…' : 'Calcular comparação'}
            </button>
          </div>
        </div>
        <Notice>
          <strong>Isto descreve variações observadas, não causa.</strong> Outros fatores (hora do dia, ventilação, clima) também alteram temperatura e umidade; nenhuma causalidade é atribuída à irrigação.
        </Notice>
        {cmp.error && <Notice kind="warn">{cmp.error}</Notice>}
        {cmp.events && (
          <CompareTable events={cmp.events} config={config} />
        )}
      </section>

      <section className="card" aria-label="Exportação">
        <div className="card__head">
          <div>
            <h2 className="card__title">Exportar CSV</h2>
            <div className="card__sub">Horários em UTC e em America/Sao_Paulo. {dataset === 'demo' ? 'Arquivos da demonstração são marcados como SIMULADO.' : ''}</div>
          </div>
        </div>
        <div className="toolbar">
          <button type="button" className="btn" disabled={exp.busy || !range} onClick={exportReadings}>
            ⬇ Leituras brutas (até 31 dias)
          </button>
          <button type="button" className="btn" disabled={exp.busy || !range} onClick={exportHourly}>
            ⬇ Agregado horário
          </button>
          <button type="button" className="btn" disabled={exp.busy || periods.length === 0} onClick={exportIrrigation}>
            ⬇ Períodos de irrigação
          </button>
        </div>
        {exp.msg && (
          <p className="small dim" role="status" style={{ margin: '0.6rem 0 0' }}>
            {exp.msg}
          </p>
        )}
      </section>
    </main>
  );
}

function CompareTable({ events, config }: { events: EventComparison[]; config: AppConfig }) {
  const sensors = config.sensors;
  const sufficient = events.filter((e) => e.sufficient);
  const mean = (id: string, key: 'deltaT' | 'deltaH') => {
    const xs = events.flatMap((e) => e.sensors.filter((s) => s.sensorId === id && s[key] !== null).map((s) => s[key] as number));
    return xs.length ? { v: xs.reduce((a, b) => a + b, 0) / xs.length, n: xs.length } : null;
  };
  if (events.length === 0) return <div className="empty">Nenhum período de irrigação encerrado no intervalo.</div>;
  return (
    <>
      <p className="small dim">
        {sufficient.length} de {events.length} evento(s) com dados suficientes.
      </p>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Início</th>
              <th className="num">Duração</th>
              {sensors.map((s) => (
                <th key={s.id} className="num">
                  {s.id.toUpperCase()} Δ temp. (°C)
                </th>
              ))}
              {sensors.map((s) => (
                <th key={`h${s.id}`} className="num">
                  {s.id.toUpperCase()} Δ UR (p.p.)
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {events.map((e) => (
              <tr key={e.startedAt}>
                <td>{formatDateTime(e.startedAt)}</td>
                <td className="num">{formatDuration(e.durationMs)}</td>
                {sensors.map((s) => {
                  const c = e.sensors.find((x) => x.sensorId === s.id);
                  return (
                    <td key={s.id} className="num" title={c?.before && c.after ? `antes: ${c.before.n} leituras · depois: ${c.after.n} leituras` : 'dados insuficientes'}>
                      {c?.deltaT != null ? `${c.deltaT > 0 ? '+' : ''}${fmtNum(c.deltaT, 2)}` : <span className="mute">insuf.</span>}
                    </td>
                  );
                })}
                {sensors.map((s) => {
                  const c = e.sensors.find((x) => x.sensorId === s.id);
                  return (
                    <td key={`h${s.id}`} className="num">
                      {c?.deltaH != null ? `${c.deltaH > 0 ? '+' : ''}${fmtNum(c.deltaH, 1)}` : <span className="mute">insuf.</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={2}>
                <strong>Média das variações observadas</strong>
              </td>
              {sensors.map((s) => {
                const m = mean(s.id, 'deltaT');
                return (
                  <td key={s.id} className="num">
                    {m ? `${m.v > 0 ? '+' : ''}${fmtNum(m.v, 2)} (n=${m.n})` : '—'}
                  </td>
                );
              })}
              {sensors.map((s) => {
                const m = mean(s.id, 'deltaH');
                return (
                  <td key={`h${s.id}`} className="num">
                    {m ? `${m.v > 0 ? '+' : ''}${fmtNum(m.v, 1)} (n=${m.n})` : '—'}
                  </td>
                );
              })}
            </tr>
          </tfoot>
        </table>
      </div>
    </>
  );
}
