import { fmtNum, formatDateTime, formatDuration } from '@orq/core';
import type { Limits, MeanPoint, QuantityStats, SeriesSummary } from '@orq/core';
import { LineChart } from './LineChart';
import { CalcChip } from './ui';

const META = {
  temperature: { title: 'Temperatura · média dos sensores', unit: '°C', digits: 1, color: '#3ddc97', minSpan: 2 },
  humidity: { title: 'Umidade do ar · média dos sensores', unit: '% UR', digits: 0, color: '#38d6e8', minSpan: 8 },
} as const;

interface Props {
  quantity: 'temperature' | 'humidity';
  points: MeanPoint[];
  summary: SeriesSummary | null;
  /** Média agora (sensores válidos), do painel em tempo real. */
  now: QuantityStats | null;
  sensorCount: number;
  from: number;
  to: number;
  binMs: number;
  limits: Limits;
  loading: boolean;
  height?: number;
}

/**
 * Gráfico da média dos sensores ao longo do tempo + indicadores do período.
 * Faixa clara = menor e maior sensor em cada intervalo (diferença entre os pontos monitorados).
 */
export function TrendCard({ quantity, points, summary, now, sensorCount, from, to, binMs, limits, loading, height = 210 }: Props) {
  const m = META[quantity];
  const v = (x: number | undefined | null) => (x === undefined || x === null ? '—' : `${fmtNum(x, m.digits)} ${m.unit}`);
  return (
    <section className="card trend" aria-label={m.title}>
      <div className="card__head">
        <div>
          <h2 className="card__title">{m.title}</h2>
          <div className="card__sub">
            Média de {sensorCount} sensores a cada {formatDuration(binMs)} · faixa = menor e maior sensor
          </div>
        </div>
        <CalcChip />
      </div>

      <div className="trend__kpis">
        <div>
          <span>Agora</span>
          <b style={{ color: m.color }}>{now && now.n === sensorCount ? v(now.mean) : '—'}</b>
          <small>{now && now.n < sensorCount ? `só ${now.n} de ${sensorCount} sensores válidos` : ' '}</small>
        </div>
        <div>
          <span>Máxima</span>
          <b>{v(summary?.max.v)}</b>
          <small>{summary ? formatDateTime(summary.max.t) : ' '}</small>
        </div>
        <div>
          <span>Mínima</span>
          <b>{v(summary?.min.v)}</b>
          <small>{summary ? formatDateTime(summary.min.t) : ' '}</small>
        </div>
        <div>
          <span>Média do período</span>
          <b>{v(summary?.mean)}</b>
          <small>{summary ? `amplitude ${fmtNum(summary.max.v - summary.min.v, m.digits)} ${quantity === 'humidity' ? 'p.p.' : m.unit}` : ' '}</small>
        </div>
        <div className="hide-tv">
          <span>Maior diferença entre sensores</span>
          <b>{summary ? `${fmtNum(summary.maxSpread.hi - summary.maxSpread.lo, m.digits)} ${quantity === 'humidity' ? 'p.p.' : m.unit}` : '—'}</b>
          <small>{summary ? formatDateTime(summary.maxSpread.t) : ' '}</small>
        </div>
      </div>

      {points.length > 0 ? (
        <LineChart
          series={[{ id: 'mean', name: 'Média', color: m.color, points: points.map((p) => ({ t: p.t, v: p.v, lo: p.lo, hi: p.hi })) }]}
          from={from}
          to={to}
          unit={m.unit}
          digits={m.digits}
          gapMs={binMs * 1.5}
          limits={limits}
          minSpan={m.minSpan}
          height={height}
          label={`${m.title}: gráfico no tempo`}
        />
      ) : (
        <div className="empty">{loading ? 'Carregando…' : `Sem intervalos com leitura dos ${sensorCount} sensores neste período.`}</div>
      )}
      <p className="tiny mute hide-tv" style={{ margin: '0.4rem 0 0' }}>
        Só entram intervalos com leitura de todos os sensores (se um falha, o trecho fica em branco em vez de a média mudar sozinha).
        {quantity === 'humidity' && ' Umidade do ar — não é umidade do substrato.'}
      </p>
    </section>
  );
}
