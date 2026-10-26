import { useEffect, useMemo, useState } from 'react';
import {
  HOUR,
  MIN,
  ROOM,
  bucketsFromHistory,
  buildSnapshot,
  fmtNum,
  formatAge,
  formatIrrigationDuration,
  formatTime,
  meanAcrossSensors,
  readingFromDto,
  simplePump,
  simpleStatus,
  startOfLocalDay,
  todayExtremes,
  trendOf,
  valueTone,
} from '@orq/core';
import type { AppConfig, IrrigationsSummary, MeanPoint, Quantity, Reading, SimpleLevel, Snapshot, Trend, ValueTone } from '@orq/core';
import { useFieldCanvas } from '../components/EnvMap';
import { useHistory } from '../hooks/useHistory';
import type { LiveState } from '../hooks/useLive';
import { rampGradientCss } from '../lib/colors';

/**
 * Painel da TV (65") e visão para quem não é técnico: uma tela fixa, 3 colunas — temperatura, umidade com os
 * aspersores, irrigação. Mesmos dados e regras do painel completo: nada é inventado.
 */
export function Simple({ live, nowMs, onFull }: { live: LiveState; nowMs: number; onFull: () => void }) {
  const data = live.data;
  const config = data?.config ?? null;

  // Últimas 24 h, ancoradas a cada 5 min (não recarrega a cada atualização da tela).
  const anchor = Math.floor(nowMs / (5 * MIN)) * 5 * MIN;
  const range = useMemo(() => (anchor > 0 ? { from: anchor - 24 * HOUR, to: anchor } : null), [anchor]);
  const hist = useHistory(range);
  const sensorIds = useMemo(() => config?.sensors.map((s) => s.id) ?? [], [config]);
  const buckets = useMemo(() => (hist.data ? bucketsFromHistory(hist.data) : []), [hist.data]);
  const tLine = useMemo(() => meanAcrossSensors(buckets, 'temperature', sensorIds, 15 * MIN), [buckets, sensorIds]);
  const hLine = useMemo(() => meanAcrossSensors(buckets, 'humidity', sensorIds, 15 * MIN), [buckets, sensorIds]);
  const today = useMemo(() => {
    if (!hist.data || hist.data.resolution !== 'raw') return null;
    const start = startOfLocalDay(nowMs);
    return todayExtremes(hist.data.series.map((s) => ({ rows: s.rows.filter((r) => (r[0] as number) >= start) })));
  }, [hist.data, nowMs]);

  if (!data || !config) {
    return <main className="tvp tvp--loading">{live.error ? `Sem dados: ${live.error.message}` : 'Carregando…'}</main>;
  }

  const latest = new Map<string, Reading | null>(Object.entries(data.latest).map(([id, r]) => [id, r ? readingFromDto(r) : null]));
  const snap = buildSnapshot(config, latest, nowMs);
  const status = simpleStatus(snap, config, nowMs);
  const pump = simplePump(data.pump, nowMs);

  return (
    <main className="tvp">
      <header className={`tvp__status tvp__status--${status.level}`} role="status">
        <div className="tvp__status-icon" aria-hidden="true">
          <StatusIcon level={status.level} />
        </div>
        <div className="tvp__status-text">
          <div className="tvp__headline">{status.headline}</div>
          <div className="tvp__details">
            {status.details.slice(0, 2).map((d) => (
              <span key={d}>{d}</span>
            ))}
          </div>
        </div>
        <div className="tvp__right">
          <Clock nowMs={nowMs} />
          <div className="tvp__updated">{snap.lastMeasuredAt ? `Última leitura ${formatAge(nowMs - snap.lastMeasuredAt)}` : 'Sem leituras ainda'}</div>
          <button type="button" className="btn btn--sm hide-tv" onClick={onFull}>
            Painel completo
          </button>
        </div>
      </header>

      <div className="tvp__cols">
        <QuantityColumn
          quantity="temperature"
          title="Temperatura"
          snap={snap}
          config={config}
          line={tLine}
          from={range?.from ?? 0}
          to={range?.to ?? 0}
          nowMs={nowMs}
          today={today && today.tMin !== null ? [today.tMin, today.tMax!] : null}
        />
        <QuantityColumn
          quantity="humidity"
          title="Umidade do ar"
          snap={snap}
          config={config}
          line={hLine}
          from={range?.from ?? 0}
          to={range?.to ?? 0}
          nowMs={nowMs}
          today={today && today.hMin !== null ? [today.hMin, today.hMax!] : null}
          pumpOn={pump.tone === 'on'}
        />
        <IrrigationColumn pump={pump} summary={data.irrigations} nowMs={nowMs} />
      </div>
    </main>
  );
}

const UNIT: Record<Quantity, { suffix: string; digits: number; threshold: number }> = {
  temperature: { suffix: '°', digits: 1, threshold: 0.5 },
  humidity: { suffix: '%', digits: 0, threshold: 3 },
};

function QuantityColumn(p: {
  quantity: Quantity;
  title: string;
  snap: Snapshot;
  config: AppConfig;
  line: MeanPoint[];
  from: number;
  to: number;
  nowMs: number;
  today: [number, number] | null;
  pumpOn?: boolean;
}) {
  const u = UNIT[p.quantity];
  const stats = p.quantity === 'temperature' ? p.snap.temperature : p.snap.humidity;
  const mean = stats?.mean ?? null;
  const limits = p.config.alerts[p.quantity];
  const tone = valueTone(mean, limits);
  const trend = trendOf(p.line, u.threshold, p.nowMs);
  const fresh = p.snap.counts.fresh;
  const never = p.snap.lastMeasuredAt === null;
  return (
    <section className={`tvp__col tvp__col--${p.quantity}`} aria-label={p.title}>
      <div className="tvp__col-head">
        <div className="tvp__label">
          {p.quantity === 'temperature' ? <ThermoIcon /> : <DropIcon />}
          {p.title}
        </div>
        {mean === null ? (
          <div className="tvp__value-row">
            <span className={`tvp__value tvp__value--empty${never ? '' : ' tvp__value--lost'}`}>{p.quantity === 'temperature' ? '--,-°' : '--%'}</span>
          </div>
        ) : (
          <div className="tvp__value-row">
            <span className={`tvp__value tone-${p.quantity}-${tone}`}>{`${fmtNum(mean, u.digits)}${u.suffix}`}</span>
            <TrendBadge trend={trend} quantity={p.quantity} />
          </div>
        )}
        <div className="tvp__word">{mean === null ? (never ? 'Aguardando a primeira leitura' : `Sem sinal · última leitura ${formatAge(p.nowMs - p.snap.lastMeasuredAt!)}`) : toneWord(p.quantity, tone, fresh)}</div>
      </div>
      <TvMap quantity={p.quantity} snapshot={p.snap} config={p.config} showSprinklers={p.quantity === 'humidity'} pumpOn={p.pumpOn ?? false} />
      <div className="tvp__scale">
        <span>{fmtNum(p.config.scales[p.quantity].min, 0)}{u.suffix}</span>
        <i style={{ background: rampGradientCss(p.quantity) }} />
        <span>{fmtNum(p.config.scales[p.quantity].max, 0)}{u.suffix}</span>
      </div>
      {p.line.length < 2 ? (
        <div className="tvp__spark-box tvp__spark-box--empty">
          <span>O gráfico das últimas 24 horas aparece aqui depois das primeiras leituras.</span>
        </div>
      ) : (
        <div className="tvp__spark-box">
          <Spark points={p.line} from={p.from} to={p.to} color={p.quantity === 'temperature' ? 'var(--tvp-temp)' : 'var(--tvp-hum)'} />
          <div className="tvp__spark-axis" aria-hidden="true">
            <span>{formatTime(p.from)} ontem</span>
            <span>{formatTime(p.from + 12 * HOUR)}</span>
            <span>agora</span>
          </div>
          <div className="tvp__spark-label">
            <span>Média dos sensores · últimas 24 h</span>
            {p.today && (
              <span>
                Hoje: mín <b>{fmtNum(p.today[0], u.digits)}{u.suffix}</b> · máx <b>{fmtNum(p.today[1], u.digits)}{u.suffix}</b>
              </span>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function TrendBadge({ trend, quantity }: { trend: Trend | null; quantity: Quantity }) {
  if (!trend) return null;
  const arrow = { up: '↑', down: '↓', flat: '→' }[trend.dir];
  const word = { up: 'subindo', down: 'descendo', flat: 'estável' }[trend.dir];
  const rate = trend.dir === 'flat' ? '' : ` ${fmtNum(Math.abs(trend.perHour), quantity === 'temperature' ? 1 : 0)}${UNIT[quantity].suffix}/h`;
  return (
    <span className={`tvp__trend tvp__trend--${trend.dir}`} title="Comparação com 1 hora atrás (média dos sensores)">
      <span className="tvp__trend-arrow">{arrow}</span>
      <span>
        {word}
        {rate}
      </span>
    </span>
  );
}

function toneWord(kind: Quantity, tone: ValueTone, fresh: number): string {
  if (fresh === 0) return 'aguardando sensores';
  if (tone === 'none') return `média de ${fresh} sensor${fresh > 1 ? 'es' : ''}`;
  if (kind === 'temperature') return { ok: 'Dentro da faixa', low: 'Frio', high: 'Quente' }[tone];
  return { ok: 'Dentro da faixa', low: 'Ar seco', high: 'Muito úmido' }[tone];
}

/** Mapa limpo para a TV: cor estimada entre os sensores, valores nos pontos e (umidade) os aspersores por cima. */
function TvMap({ quantity, snapshot, config, showSprinklers, pumpOn }: { quantity: Quantity; snapshot: Snapshot; config: AppConfig; showSprinklers: boolean; pumpOn: boolean }) {
  const { stageRef, canvasRef, coverage } = useFieldCanvas(quantity, snapshot, config, { hatch: false, grid: false, transparent: true });
  const u = UNIT[quantity];
  return (
    <div className="tvp__map" ref={stageRef}>
      <canvas ref={canvasRef} role="img" aria-label={`Mapa de ${quantity === 'temperature' ? 'temperatura' : 'umidade'} estimado entre os sensores`} />
      {showSprinklers && (
        <svg className={`tvp__spr${pumpOn ? ' tvp__spr--on' : ''}`} viewBox={`0 0 ${ROOM.lengthM} ${ROOM.widthM}`} preserveAspectRatio="none" aria-hidden="true">
          {config.irrigation.sprinklers.map((s) => (
            <g key={s.id}>
              <circle className="tvp__spr-area" cx={s.xM} cy={s.yM} r={s.radiusM} vectorEffect="non-scaling-stroke" />
              <circle className="tvp__spr-head" cx={s.xM} cy={s.yM} r={0.16} vectorEffect="non-scaling-stroke" />
            </g>
          ))}
        </svg>
      )}
      {snapshot.sensors.map((s) => {
        const v = quantity === 'temperature' ? s.reading?.temperatureC : s.reading?.humidityPct;
        const state = s.valid && v !== undefined ? 'ok' : s.ageMs === null ? 'wait' : 'lost';
        return (
          <div
            key={s.sensor.id}
            className={`tvp__pin tvp__pin--${state}`}
            style={{ left: `${(s.sensor.xM / ROOM.lengthM) * 100}%`, top: `${(s.sensor.yM / ROOM.widthM) * 100}%` }}
          >
            <b>{state === 'ok' ? `${fmtNum(v!, u.digits)}${u.suffix}` : state === 'wait' ? 'aguardando' : 'sem sinal'}</b>
            <small>{s.sensor.name}</small>
          </div>
        );
      })}
      {snapshot.counts.fresh > 0 && coverage.state !== 'ok' && <div className="tvp__map-flag">Poucos sensores para colorir o mapa</div>}
    </div>
  );
}

function IrrigationColumn({ pump, summary, nowMs }: { pump: ReturnType<typeof simplePump>; summary: IrrigationsSummary; nowMs: number }) {
  const dayStart = startOfLocalDay(nowMs);
  return (
    <section className="tvp__col tvp__col--irr" aria-label="Irrigação">
      <div className="tvp__label">
        <SprinklerIcon />
        Irrigação
      </div>
      <div className={`tvp__pump tvp__pump--${pump.tone}`}>
        <svg className="tvp__pump-icon" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 2.5c-3.6 4.6-6.5 8.3-6.5 11.6A6.5 6.5 0 0 0 12 20.6a6.5 6.5 0 0 0 6.5-6.5C18.5 10.8 15.6 7.1 12 2.5z" fill="currentColor" />
        </svg>
        <div>
          <div className="tvp__pump-label">{pump.label}</div>
          <div className="tvp__small">{pump.detail}</div>
        </div>
      </div>

      {pump.tone === 'none' && summary.last.length === 0 ? (
        <div className="tvp__soon">
          <div className="tvp__list-title">Quando a bomba for conectada, aparece aqui</div>
          <ul>
            <li>se a bomba está ligada agora</li>
            <li>quantas vezes irrigou hoje e por quanto tempo</li>
            <li>horário e duração das últimas irrigações</li>
          </ul>
        </div>
      ) : (
        <>
          <div className="tvp__today">
            <div>
              <div className="tvp__today-n">{summary.todayCount}</div>
              <div className="tvp__small">irrigaç{summary.todayCount === 1 ? 'ão' : 'ões'} hoje</div>
            </div>
            <div>
              <div className="tvp__today-n">{summary.todayCount ? formatIrrigationDuration(summary.todayTotalMs) : '0 min'}</div>
              <div className="tvp__small">tempo total hoje</div>
            </div>
          </div>

          <div className="tvp__list-title">Últimas irrigações</div>
          {summary.last.length === 0 ? (
            <div className="tvp__empty">Nenhuma irrigação registrada ainda.</div>
          ) : (
            <ol className="tvp__list">
              {summary.last.map((e) => {
                const start = Date.parse(e.startedAt);
                const running = e.endedAt === null;
                return (
                  <li key={e.startedAt} className={running ? 'tvp__list-running' : undefined}>
                    <span className="tvp__list-when">
                      {start >= dayStart ? formatTime(start) : `${new Date(start).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit' })} ${formatTime(start)}`}
                    </span>
                    <span className="tvp__list-dur">{running ? `ligada há ${formatIrrigationDuration(nowMs - start)}` : formatIrrigationDuration(e.durationMs)}</span>
                    {e.endReason === 'sem_sinal' && <span className="tvp__list-note">sem sinal no fim</span>}
                  </li>
                );
              })}
            </ol>
          )}
          <div className="tvp__footnote">Horários com precisão de ~2 min.</div>
        </>
      )}
    </section>
  );
}

/** Linha das últimas 24 h (média dos sensores). Trechos sem todos os sensores ficam em branco, como no painel. */
function Spark({ points, from, to, color }: { points: MeanPoint[]; from: number; to: number; color: string }) {
  if (points.length < 2 || to <= from) return <div className="tvp__spark tvp__spark--empty">sem dados nas últimas 24 h</div>;
  const vs = points.map((p) => p.v);
  let lo = Math.min(...vs);
  let hi = Math.max(...vs);
  if (hi - lo < 1) {
    const mid = (hi + lo) / 2;
    lo = mid - 0.5;
    hi = mid + 0.5;
  }
  const W = 300;
  const H = 60;
  const x = (t: number) => ((t - from) / (to - from)) * W;
  const y = (v: number) => H - 4 - ((v - lo) / (hi - lo)) * (H - 8);
  let d = '';
  points.forEach((p, i) => {
    const gap = i > 0 && p.t - points[i - 1]!.t > 45 * MIN;
    d += `${i === 0 || gap ? 'M' : 'L'}${x(p.t).toFixed(1)} ${y(p.v).toFixed(1)} `;
  });
  return (
    <svg className="tvp__spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
      <path d={d} fill="none" stroke={color} strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function Clock({ nowMs }: { nowMs: number }) {
  const [t, setT] = useState(nowMs);
  useEffect(() => {
    const id = setInterval(() => setT((v) => v + 1000), 1000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => setT(nowMs), [nowMs]);
  const d = new Date(t);
  return (
    <div className="tvp__clock">
      <span className="tvp__time">{d.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' })}</span>
      <span className="tvp__date">{capitalize(d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'long', day: 'numeric', month: 'long' }))}</span>
    </div>
  );
}

function StatusIcon({ level }: { level: SimpleLevel }) {
  const d = {
    ok: 'M5 12.5l4.5 4.5L19 7.5',
    warn: 'M12 6v8M12 18.2v.1',
    bad: 'M7 7l10 10M17 7L7 17',
    setup: 'M12 7.5V12l3 2M12 3.5a8.5 8.5 0 1 0 0 17a8.5 8.5 0 1 0 0-17z',
  }[level];
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}

const ThermoIcon = () => (
  <svg className="tvp__label-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <path d="M10 4.5a2 2 0 0 1 4 0v9.3a4 4 0 1 1-4 0z" />
    <path d="M12 9v7" />
  </svg>
);
const DropIcon = () => (
  <svg className="tvp__label-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 3.5c-3.3 4.2-6 7.6-6 10.6a6 6 0 0 0 12 0c0-3-2.7-6.4-6-10.6z" />
  </svg>
);
const SprinklerIcon = () => (
  <svg className="tvp__label-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <path d="M12 21v-7M9 14h6M12 10V8M7.5 9.5 6 8M16.5 9.5 18 8M5 13H3M21 13h-2" />
  </svg>
);

const capitalize = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
