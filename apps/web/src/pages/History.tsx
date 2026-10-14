import { useMemo, useState } from 'react';
import {
  DAY,
  HOUR,
  MIN,
  bucketsFromHistory,
  buildSnapshot,
  dewPointC,
  findGaps,
  formatDateTime,
  formatDuration,
  groupBySensor,
  localInputToUtc,
  meanAcrossSensors,
  readingsFromFullHistory,
  summarizePeriod,
  toCsv,
  utcToLocalInput,
  vpdKpa,
} from '@orq/core';
import type { AppConfig, CsvCell } from '@orq/core';
import { LineChart } from '../components/LineChart';
import type { ChartSeries } from '../components/LineChart';
import { PeriodCard } from '../components/Indicators';
import { Chip, MeasuredChip, Notice } from '../components/ui';
import { useHistory } from '../hooks/useHistory';
import { api } from '../lib/api';
import { SERIES_COLORS } from '../lib/colors';
import { downloadText } from '../lib/derive';
import { fetchRawChunked } from '../lib/history';

type Preset = '24h' | '7d' | '30d' | 'custom';
const PRESETS: [Preset, string, number][] = [
  ['24h', 'Últimas 24 horas', DAY],
  ['7d', '7 dias', 7 * DAY],
  ['30d', '30 dias', 30 * DAY],
];
const MEAN_COLOR = '#ffffff';
const stamp = (ms: number) => utcToLocalInput(ms).replace(/[-:T]/g, '').slice(0, 12);

export function History({ config, nowMs }: { config: AppConfig | null; nowMs: number }) {
  const [preset, setPreset] = useState<Preset>('24h');
  const [customFrom, setCustomFrom] = useState(() => utcToLocalInput(nowMs - 3 * DAY));
  const [customTo, setCustomTo] = useState(() => utcToLocalInput(nowMs));
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [showMean, setShowMean] = useState(true);
  const [reload, setReload] = useState(0);
  const [exp, setExp] = useState<{ busy: boolean; msg: string | null }>({ busy: false, msg: null });

  const anchor = Math.floor(nowMs / (5 * MIN)) * (5 * MIN);
  const { range, rangeError } = useMemo(() => {
    if (preset !== 'custom') return { range: { from: anchor - PRESETS.find((p) => p[0] === preset)![2], to: anchor }, rangeError: null as string | null };
    const f = localInputToUtc(customFrom);
    const t = localInputToUtc(customTo);
    if (f === null || t === null) return { range: null, rangeError: 'Informe início e fim válidos.' };
    if (t <= f) return { range: null, rangeError: 'O fim deve ser posterior ao início.' };
    if (t - f > 400 * DAY) return { range: null, rangeError: 'Intervalo máximo: 400 dias.' };
    return { range: { from: f, to: t }, rangeError: null };
  }, [preset, anchor, customFrom, customTo]);

  const hist = useHistory(range, reload);
  const buckets = useMemo(() => (hist.data ? bucketsFromHistory(hist.data) : []), [hist.data]);
  const hourly = hist.data?.resolution === 'hourly';
  const sensors = useMemo(() => config?.sensors ?? [], [config]);
  const ids = useMemo(() => sensors.map((s) => s.id), [sensors]);
  const colorOf = (id: string) => SERIES_COLORS[Math.max(0, ids.indexOf(id)) % SERIES_COLORS.length]!;
  const span = range ? range.to - range.from : DAY;
  const meanBin = span <= 2 * DAY ? 10 * MIN : span <= 10 * DAY ? HOUR : 3 * HOUR;

  const { tSeries, hSeries } = useMemo(() => {
    const per = groupBySensor(buckets, (b) => b.t);
    const mk = (q: 'temperature' | 'humidity'): ChartSeries[] => {
      const out: ChartSeries[] = sensors
        .filter((s) => !hidden.has(s.id))
        .map((s) => ({
          id: s.id,
          name: `${s.id.toUpperCase()} · ${s.name}`,
          color: colorOf(s.id),
          points: (per.get(s.id) ?? []).map((b) =>
            q === 'temperature' ? { t: b.t, v: b.tAvg, lo: hourly ? b.tMin : undefined, hi: hourly ? b.tMax : undefined } : { t: b.t, v: b.hAvg, lo: hourly ? b.hMin : undefined, hi: hourly ? b.hMax : undefined },
          ),
        }));
      if (showMean) out.push({ id: 'mean', name: `Média dos ${ids.length} sensores`, color: MEAN_COLOR, points: meanAcrossSensors(buckets, q, ids, meanBin).map((p) => ({ t: p.t, v: p.v })) });
      return out;
    };
    return { tSeries: mk('temperature'), hSeries: mk('humidity') };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buckets, sensors, hidden, hourly, showMean, meanBin, ids]);

  const gapMs = (hourly ? 90 : config?.freshness.freshMaxMin ?? 60) * MIN;
  const gaps = useMemo(
    () => [...groupBySensor(buckets, (b) => b.t)].flatMap(([id, arr]) => findGaps(arr, id, gapMs)).sort((a, b) => b.to - b.from - (a.to - a.from)),
    [buckets, gapMs],
  );
  const summary = useMemo(() => summarizePeriod(buckets.filter((b) => !hidden.has(b.sensorId))), [buckets, hidden]);
  const nameSnapshot = useMemo(() => (config ? buildSnapshot(config, new Map(), nowMs) : null), [config, nowMs]);
  if (!config || !nameSnapshot) return <div className="container"><div className="empty">Carregando…</div></div>;
  const nameOf = (id: string) => sensors.find((s) => s.id === id)?.name ?? id;

  const exportReadings = async () => {
    if (!range) return;
    if (range.to - range.from > 31 * DAY) return setExp({ busy: false, msg: 'Leituras brutas: máximo de 31 dias. Use o CSV horário para períodos maiores.' });
    setExp({ busy: true, msg: 'Buscando leituras…' });
    try {
      const raw = await fetchRawChunked(range.from, range.to, { full: true, onProgress: (d, t) => setExp({ busy: true, msg: `Buscando leituras… ${d}/${t}` }) });
      const rows = readingsFromFullHistory(raw).map((r) => {
        const dpv = vpdKpa(r.temperatureC, r.humidityPct);
        const dew = dewPointC(r.temperatureC, r.humidityPct);
        return [
          r.sensorId,
          nameOf(r.sensorId),
          new Date(r.measuredAt).toISOString(),
          formatDateTime(r.measuredAt),
          new Date(r.receivedAt).toISOString(),
          r.timeBasis === 'source' ? 'origem' : 'recebimento',
          r.temperatureC,
          r.humidityPct,
          dpv === null ? null : Math.round(dpv * 1000) / 1000,
          dew === null ? null : Math.round(dew * 100) / 100,
          r.batteryPct,
        ];
      });
      downloadText(
        `orquidario_leituras_${stamp(range.from)}_${stamp(range.to)}.csv`,
        toCsv(['sensor_id', 'sensor_nome', 'medido_em_utc', 'medido_em_america_sao_paulo', 'recebido_em_utc', 'base_do_horario', 'temperatura_c', 'umidade_relativa_pct', 'dpv_ar_kpa', 'ponto_orvalho_c', 'bateria_pct'], rows),
      );
      setExp({ busy: false, msg: `${rows.length} leituras exportadas${raw.truncated ? ' (atenção: algum trecho foi truncado pelo limite da API)' : ''}.` });
    } catch (e) {
      setExp({ busy: false, msg: `Falha na exportação: ${(e as Error).message}` });
    }
  };

  const exportHourly = async () => {
    if (!range) return;
    setExp({ busy: true, msg: 'Buscando agregado horário…' });
    try {
      const h = await api.history(range.from, range.to, { res: 'hourly' });
      const hb = bucketsFromHistory(h);
      const rows: CsvCell[][] = hb.map((b) => [b.sensorId, nameOf(b.sensorId), new Date(b.t).toISOString(), formatDateTime(b.t), b.tAvg, b.tMin, b.tMax, b.hAvg, b.hMin, b.hMax, b.n]);
      const tMean = new Map(meanAcrossSensors(hb, 'temperature', ids, HOUR).map((p) => [p.t - HOUR / 2, p.v]));
      for (const p of meanAcrossSensors(hb, 'humidity', ids, HOUR)) {
        const t = p.t - HOUR / 2;
        rows.push(['media', `Média dos ${ids.length} sensores`, new Date(t).toISOString(), formatDateTime(t), tMean.get(t) ?? null, null, null, p.v, null, null, p.n]);
      }
      downloadText(
        `orquidario_horario_${stamp(range.from)}_${stamp(range.to)}.csv`,
        toCsv(['sensor_id', 'sensor_nome', 'hora_utc', 'hora_america_sao_paulo', 'temperatura_media_c', 'temperatura_min_c', 'temperatura_max_c', 'umidade_media_pct', 'umidade_min_pct', 'umidade_max_pct', 'amostras_ou_sensores'], rows),
      );
      setExp({ busy: false, msg: `${rows.length} linhas horárias exportadas (inclui a média dos sensores).` });
    } catch (e) {
      setExp({ busy: false, msg: `Falha na exportação: ${(e as Error).message}` });
    }
  };

  return (
    <main className="container">
      <section className="card">
        <div className="card__head">
          <div>
            <h2 className="card__title">Histórico</h2>
            <div className="card__sub">Até 48 h: leituras brutas; acima: médias horárias com faixa mín.–máx. Períodos sem dados ficam em branco, nunca preenchidos.</div>
          </div>
          <div className="toolbar">
            <MeasuredChip />
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
        {hist.data?.truncated && <Notice kind="warn">O limite de linhas foi atingido; os pontos mais antigos foram omitidos. Reduza o período.</Notice>}
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
              <div className="card__sub">{unit === '°C' ? 'Temperatura do ar em cada ponto.' : 'Umidade do ar — não é umidade do substrato nem hidratação das raízes.'}</div>
            </div>
            <MeasuredChip />
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
            <label className="check">
              <input type="checkbox" checked={showMean} onChange={(e) => setShowMean(e.target.checked)} />
              <span style={{ color: MEAN_COLOR }}>●</span> Média dos {ids.length} sensores
            </label>
            {hourly && <span className="mute">Faixa clara = mín.–máx. na hora</span>}
            {(limits.min !== null || limits.max !== null) && <span style={{ color: 'var(--amber)' }}>┄ limite configurado</span>}
          </div>
          {range && <LineChart series={series as ChartSeries[]} from={range.from} to={range.to} unit={unit} digits={digits} gapMs={gapMs} limits={limits} minSpan={minSpan} label={title} />}
          {hist.data && buckets.length === 0 && <div className="empty">Nenhuma leitura no período.</div>}
        </section>
      ))}

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
        <p className="tiny mute" style={{ margin: '0.5rem 0 0' }}>
          Sensores Zigbee costumam enviar leitura quando o valor muda; em períodos estáveis o intervalo entre leituras pode ser maior sem que haja falha.
        </p>
      </section>

      <section className="card" aria-label="Exportação">
        <div className="card__head">
          <div>
            <h2 className="card__title">Exportar CSV</h2>
            <div className="card__sub">Horários em UTC e em America/Sao_Paulo.</div>
          </div>
        </div>
        <div className="toolbar">
          <button type="button" className="btn" disabled={exp.busy || !range} onClick={exportReadings}>
            ⬇ Leituras brutas (até 31 dias)
          </button>
          <button type="button" className="btn" disabled={exp.busy || !range} onClick={exportHourly}>
            ⬇ Agregado horário + média
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
