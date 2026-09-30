import { useEffect, useMemo, useState } from 'react';
import {
  DAY,
  HOUR,
  MIN,
  bucketsFromHistory,
  buildSnapshot,
  findGaps,
  formatAge,
  formatDateTime,
  formatTime,
  groupBySensor,
  meanAcrossSensors,
  readingFromDto,
  snapshotAtInstant,
  summarizePeriod,
  summarizeSeries,
} from '@orq/core';
import type { Gap, Reading } from '@orq/core';
import { MapCard } from '../components/EnvMap';
import { AlertsCard, IndicatorsTable, KpiGrid, PeriodCard, SensorCards } from '../components/Indicators';
import { IrrigationCard } from '../components/IrrigationPlan';
import { ReplayPanel } from '../components/ReplayPanel';
import { TrendCard } from '../components/TrendCard';
import { Chip, FreshnessChip, Notice } from '../components/ui';
import { useHistory } from '../hooks/useHistory';
import type { LiveState } from '../hooks/useLive';
import { bucketToReading } from '../lib/derive';

interface Props {
  live: LiveState;
  nowMs: number;
  tv: boolean;
  onGoConfig: () => void;
  onGoData: () => void;
}

const HOURLY_TOLERANCE_MIN = 90;
const PERIODS = [
  { id: '24h', label: '24 horas', span: DAY, bin: 10 * MIN },
  { id: '7d', label: '7 dias', span: 7 * DAY, bin: HOUR },
  { id: '30d', label: '30 dias', span: 30 * DAY, bin: 3 * HOUR },
] as const;

export function Dashboard({ live, nowMs, tv, onGoConfig, onGoData }: Props) {
  const data = live.data;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [periodId, setPeriodId] = useState<(typeof PERIODS)[number]['id']>('24h');
  const [replayOn, setReplayOn] = useState(false);
  const [replayAnchor, setReplayAnchor] = useState(0);
  const [at, setAt] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(30);
  const [replayHours, setReplayHours] = useState(24);

  // Período dos gráficos: renova a cada 5 min (a leitura do eWeLink é a cada 2 min).
  const liveAnchor = Math.floor(nowMs / (5 * MIN)) * (5 * MIN);
  const period = PERIODS.find((p) => p.id === periodId)!;
  const trendRange = useMemo(() => (data ? { from: liveAnchor - period.span, to: liveAnchor } : null), [data, liveAnchor, period.span]);
  const trendHist = useHistory(trendRange);

  const replayRange = useMemo(() => (replayOn ? { from: replayAnchor - replayHours * HOUR, to: replayAnchor } : null), [replayOn, replayAnchor, replayHours]);
  const replayHist = useHistory(replayRange);

  const config = data?.config;
  const sensorIds = useMemo(() => config?.sensors.map((s) => s.id) ?? [], [config]);
  const trendBuckets = useMemo(() => (trendHist.data ? bucketsFromHistory(trendHist.data) : []), [trendHist.data]);
  const tPoints = useMemo(() => meanAcrossSensors(trendBuckets, 'temperature', sensorIds, period.bin), [trendBuckets, sensorIds, period.bin]);
  const hPoints = useMemo(() => meanAcrossSensors(trendBuckets, 'humidity', sensorIds, period.bin), [trendBuckets, sensorIds, period.bin]);
  const periodSummary = useMemo(() => (trendHist.data ? summarizePeriod(trendBuckets) : null), [trendHist.data, trendBuckets]);

  const replayBuckets = useMemo(() => (replayHist.data ? bucketsFromHistory(replayHist.data) : []), [replayHist.data]);
  const hourly = replayHist.data?.resolution === 'hourly';
  const bySensor = useMemo(() => groupBySensor(replayBuckets.map((b) => bucketToReading(b)), (r) => r.measuredAt) as Map<string, Reading[]>, [replayBuckets]);
  const gaps: Gap[] = useMemo(() => {
    if (!config) return [];
    const thr = (hourly ? HOURLY_TOLERANCE_MIN : config.freshness.freshMaxMin) * MIN;
    return [...groupBySensor(replayBuckets, (b) => b.t)].flatMap(([id, arr]) => findGaps(arr, id, thr)).sort((a, b) => a.from - b.from);
  }, [replayBuckets, config, hourly]);

  useEffect(() => {
    if (!replayOn || !playing || !replayRange) return;
    const id = setInterval(() => {
      setAt((t) => {
        const next = t + speed * MIN * 0.25;
        if (next >= replayRange.to) {
          setPlaying(false);
          return replayRange.to;
        }
        return next;
      });
    }, 250);
    return () => clearInterval(id);
  }, [replayOn, playing, speed, replayRange]);

  if (!data || !config) {
    return (
      <div className="container">
        {live.error ? (
          <Notice kind="bad">
            <strong>Não foi possível carregar os dados.</strong> {live.error.message}
          </Notice>
        ) : (
          <div className="empty">Carregando…</div>
        )}
      </div>
    );
  }

  const latest = new Map<string, Reading | null>(Object.entries(data.latest).map(([id, r]) => [id, r ? readingFromDto(r) : null]));
  const noReadingsEver = [...latest.values()].every((r) => r === null);
  const eu = data.integration.ewelink;
  const inReplay = replayOn && replayRange !== null && replayHist.data !== null;
  const snapshot = inReplay ? snapshotAtInstant(config, bySensor, at, (hourly ? HOURLY_TOLERANCE_MIN : config.replay.toleranceMin) * MIN) : buildSnapshot(config, latest, nowMs);
  const liveSnapshot = buildSnapshot(config, latest, nowMs);
  const selected = snapshot.sensors.find((s) => s.sensor.id === selectedId) ?? null;
  const instantLabel = inReplay ? `replay · ${formatDateTime(at)}` : undefined;
  const unlinked = config.sensors.filter((s) => !s.externalId).length;

  const maps = (
    <div className="maps">
      <MapCard quantity="temperature" snapshot={snapshot} config={config} selectedId={selectedId} onSelect={setSelectedId} instantLabel={instantLabel} replay={inReplay} />
      <MapCard quantity="humidity" snapshot={snapshot} config={config} selectedId={selectedId} onSelect={setSelectedId} instantLabel={instantLabel} replay={inReplay} />
    </div>
  );
  const trendProps = { sensorCount: sensorIds.length, from: trendRange?.from ?? 0, to: trendRange?.to ?? 0, binMs: period.bin, loading: trendHist.loading };
  const trends = (
    <>
      <TrendCard quantity="temperature" points={tPoints} summary={summarizeSeries(tPoints)} now={liveSnapshot.temperature} limits={config.alerts.temperature} height={tv ? 150 : 210} {...trendProps} />
      <TrendCard quantity="humidity" points={hPoints} summary={summarizeSeries(hPoints)} now={liveSnapshot.humidity} limits={config.alerts.humidity} height={tv ? 150 : 210} {...trendProps} />
    </>
  );
  const irrigation = <IrrigationCard config={config} pump={data.pump} nowMs={nowMs} />;

  return (
    <main className="container">
      {!tv && (!eu.connected || unlinked > 0 || eu.lastError) && (
        <SetupNotice connected={eu.connected} configured={eu.configured} unlinked={unlinked} error={eu.lastError?.message ?? null} failures={eu.consecutiveFailures} onGoData={onGoData} onGoConfig={onGoConfig} />
      )}
      {noReadingsEver && (
        <Notice kind="warn">
          <strong>Aguardando a primeira leitura dos sensores.</strong> Nada é exibido como medido enquanto não houver leitura real.
        </Notice>
      )}

      {inReplay && replayRange && (
        <ReplayPanel
          from={replayRange.from}
          to={replayRange.to}
          at={at}
          onAt={setAt}
          playing={playing}
          onPlaying={setPlaying}
          speed={speed}
          onSpeed={setSpeed}
          windowHours={replayHours}
          onWindowHours={(h) => {
            setReplayHours(h);
            setAt(replayAnchor - (Math.min(h, 24) * HOUR) / 2);
            setPlaying(false);
          }}
          gaps={gaps}
          loading={replayHist.loading}
          hourly={!!hourly}
          toleranceMin={config.replay.toleranceMin}
          stepMs={hourly ? HOUR : 5 * MIN}
          onExit={() => {
            setReplayOn(false);
            setPlaying(false);
          }}
          error={replayHist.error?.message}
        />
      )}
      {replayOn && !inReplay && <Notice>{replayHist.error ? `Não foi possível carregar o histórico: ${replayHist.error.message}` : 'Carregando histórico para o replay…'}</Notice>}

      <KpiGrid snapshot={snapshot} replay={inReplay} />
      {!tv && <AlertsCard snapshot={snapshot} alerts={config.alerts} />}
      {maps}

      {!tv && (
        <div className="card period-bar" style={{ padding: '0.6rem 1rem' }}>
          <div className="seg" role="group" aria-label="Período dos gráficos">
            {PERIODS.map((p) => (
              <button key={p.id} type="button" aria-pressed={periodId === p.id} onClick={() => setPeriodId(p.id)}>
                {p.label}
              </button>
            ))}
          </div>
          {replayOn ? (
            <Chip kind="warn">Mapas em replay · gráficos e bomba em tempo real</Chip>
          ) : (
            <button
              type="button"
              className="btn btn--sm"
              onClick={() => {
                setReplayAnchor(liveAnchor);
                setAt(liveAnchor - HOUR);
                setPlaying(false);
                setReplayOn(true);
              }}
            >
              ⏮ Replay dos mapas
            </button>
          )}
        </div>
      )}

      {tv ? (
        <div className="tv-bottom">
          {trends}
          {irrigation}
        </div>
      ) : (
        <>
          <div className="trends">{trends}</div>
          <div className="card" style={{ padding: '0.7rem 1rem' }} aria-live="polite">
            {selected ? (
              <div className="toolbar" style={{ gap: '0.5rem 1rem' }}>
                <strong>
                  {selected.sensor.id.toUpperCase()} · {selected.sensor.name}
                </strong>
                <FreshnessChip freshness={selected.freshness} replay={inReplay} />
                <span className="small dim">
                  {selected.reading
                    ? `Leitura de ${formatDateTime(selected.reading.measuredAt)} (${inReplay ? 'no instante do replay' : formatAge(selected.ageMs)}) · posição ${selected.sensor.xM.toFixed(1)} × ${selected.sensor.yM.toFixed(1)} m${selected.sensor.positionProvisional ? ' (provisória)' : ''}`
                    : 'Sem leitura disponível.'}
                </span>
                <button type="button" className="btn btn--sm btn--ghost" onClick={() => setSelectedId(null)}>
                  Limpar seleção
                </button>
              </div>
            ) : (
              <span className="small mute">Toque em um sensor (no mapa ou nos cartões) para destacar sua leitura, horário e situação.</span>
            )}
          </div>
          <SensorCards snapshot={snapshot} links={data.links} selectedId={selectedId} onSelect={setSelectedId} replay={inReplay} />
          {irrigation}
          <IndicatorsTable snapshot={snapshot} replay={inReplay} />
          <PeriodCard summary={periodSummary} snapshot={liveSnapshot} periodLabel={`${period.label} até ${formatTime(liveAnchor)}`} resolutionNote="Extremos de cada sensor individual." />
        </>
      )}
    </main>
  );
}

function SetupNotice(p: { connected: boolean; configured: boolean; unlinked: number; error: string | null; failures: number; onGoData: () => void; onGoConfig: () => void }) {
  if (p.connected && p.error) {
    return (
      <Notice kind="bad">
        <strong>Falha na leitura do eWeLink ({p.failures}×):</strong> {p.error}{' '}
        <button type="button" className="btn btn--sm" onClick={p.onGoData}>
          Ver integração
        </button>
      </Notice>
    );
  }
  if (!p.connected) {
    return (
      <Notice kind="warn">
        <strong>eWeLink não conectado.</strong> {p.configured ? 'Conecte sua conta para receber as leituras.' : 'Falta configurar a credencial do app eWeLink no servidor.'}{' '}
        <button type="button" className="btn btn--sm" onClick={p.onGoData}>
          Dados e integração
        </button>
      </Notice>
    );
  }
  return (
    <Notice kind="warn">
      <strong>{p.unlinked} sensor(es) sem vínculo.</strong> Escolha qual dispositivo eWeLink corresponde a cada sensor.{' '}
      <button type="button" className="btn btn--sm" onClick={p.onGoConfig}>
        Configurações
      </button>
    </Notice>
  );
}
