import { useEffect, useMemo, useState } from 'react';
import {
  HOUR,
  MIN,
  bucketsFromHistory,
  buildSnapshot,
  findGaps,
  formatAge,
  formatDateTime,
  formatDuration,
  formatTime,
  groupBySensor,
  periodFromDto,
  readingFromDto,
  snapshotAtInstant,
  summarizePeriod,
} from '@orq/core';
import type { Dataset, Gap, IrrigationPeriod, Reading } from '@orq/core';
import { MapCard } from '../components/EnvMap';
import { AlertsCard, IndicatorsTable, KpiGrid, PeriodCard, SensorCards } from '../components/Indicators';
import { IrrigationCard } from '../components/IrrigationPlan';
import type { PlanState, SimOverride } from '../components/IrrigationPlan';
import { ReplayPanel } from '../components/ReplayPanel';
import { Chip, FreshnessChip, Notice } from '../components/ui';
import { useHistory } from '../hooks/useHistory';
import type { LiveState } from '../hooks/useLive';
import { bucketToReading } from '../lib/derive';

interface Props {
  live: LiveState;
  nowMs: number;
  dataset: Dataset;
  tv: boolean;
  onGoConfig: () => void;
}

const HOURLY_TOLERANCE_MIN = 90;

export function Dashboard({ live, nowMs, dataset, tv, onGoConfig }: Props) {
  const data = live.data;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [replayOn, setReplayOn] = useState(false);
  const [replayAnchor, setReplayAnchor] = useState(0);
  const [at, setAt] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(30);
  const [windowHours, setWindowHours] = useState(24);
  const [override, setOverride] = useState<SimOverride>('auto');

  // Histórico de contexto: alimenta o replay e as máximas/mínimas do período. Renova a cada 5 min.
  const liveAnchor = Math.floor(nowMs / (5 * MIN)) * (5 * MIN);
  const anchor = replayOn ? replayAnchor : liveAnchor;
  const range = useMemo(() => (data ? { from: anchor - windowHours * HOUR, to: anchor } : null), [data, anchor, windowHours]);
  const hist = useHistory(dataset, range);

  const config = data?.config;
  const buckets = useMemo(() => (hist.data ? bucketsFromHistory(hist.data) : []), [hist.data]);
  const hourly = hist.data?.resolution === 'hourly';
  const bySensor = useMemo(() => {
    const g = groupBySensor(buckets.map((b) => bucketToReading(b)), (r) => r.measuredAt);
    return g as Map<string, Reading[]>;
  }, [buckets]);
  const summary = useMemo(() => (hist.data ? summarizePeriod(buckets) : null), [hist.data, buckets]);
  const histPeriods: IrrigationPeriod[] = useMemo(() => (hist.data ? hist.data.irrigation.map(periodFromDto) : []), [hist.data]);

  const gaps: Gap[] = useMemo(() => {
    if (!config) return [];
    const thr = (hourly ? HOURLY_TOLERANCE_MIN : config.freshness.freshMaxMin) * MIN;
    const per = groupBySensor(buckets, (b) => b.t);
    const out: Gap[] = [];
    for (const [id, arr] of per) out.push(...findGaps(arr, id, thr));
    // união simples para a linha do tempo: qualquer sensor sem leitura
    return out.sort((a, b) => a.from - b.from);
  }, [buckets, config, hourly]);

  // Reprodução
  useEffect(() => {
    if (!replayOn || !playing || !range) return;
    const id = setInterval(() => {
      setAt((t) => {
        const next = t + speed * MIN * 0.25;
        if (next >= range.to) {
          setPlaying(false);
          return range.to;
        }
        return next;
      });
    }, 250);
    return () => clearInterval(id);
  }, [replayOn, playing, speed, range]);

  const enterReplay = () => {
    setReplayAnchor(liveAnchor);
    setAt(liveAnchor - HOUR);
    setPlaying(false);
    setReplayOn(true);
  };
  const exitReplay = () => {
    setReplayOn(false);
    setPlaying(false);
  };

  if (!data || !config) {
    return (
      <div className="container">
        {live.error ? (
          <Notice kind="bad">
            <strong>Não foi possível carregar os dados.</strong> {live.error.message}
            {live.error.status === 401 && ' Informe o token de visualização em “Dados e integração”.'}
          </Notice>
        ) : (
          <div className="empty">Carregando…</div>
        )}
      </div>
    );
  }

  const latest = new Map<string, Reading | null>(Object.entries(data.latest).map(([id, r]) => [id, r ? readingFromDto(r) : null]));
  const noReadingsEver = [...latest.values()].every((r) => r === null);
  const tolMin = hourly ? HOURLY_TOLERANCE_MIN : config.replay.toleranceMin;
  const inReplay = replayOn && range !== null && hist.data !== null;
  const snapshot = inReplay ? snapshotAtInstant(config, bySensor, at, tolMin * MIN) : buildSnapshot(config, latest, nowMs);

  // Estado do relé exibido
  const relay = data.relay;
  let planState: PlanState;
  if (inReplay) {
    planState = relay.comm === 'no_data' ? 'nodata' : histPeriods.some((p) => p.startedAt <= at && (p.endedAt ?? Infinity) > at) ? 'on' : 'off';
  } else if (relay.comm === 'ok') planState = relay.state === 'on' ? 'on' : 'off';
  else planState = relay.comm === 'lost' ? 'lost' : 'nodata';
  if (dataset === 'demo' && override !== 'auto') planState = override;

  const recent = data.recentIrrigation.map(periodFromDto);
  const lastClosed = [...(inReplay ? histPeriods.filter((p) => p.startedAt <= at) : recent)].reverse().find((p) => p.endedAt !== null);
  const lastPeriodText = lastClosed
    ? `Último período com estado “ligado” observado: ${formatDateTime(lastClosed.startedAt)} (${formatDuration((lastClosed.endedAt as number) - lastClosed.startedAt)}) — sem volume ou água distribuída confirmados.`
    : null;

  const selected = snapshot.sensors.find((s) => s.sensor.id === selectedId) ?? null;
  const instantLabel = inReplay ? `replay · ${formatDateTime(at)}` : undefined;
  const periodLabel = `${windowHours === 168 ? '7 dias' : `${windowHours} h`} até ${formatTime(anchor)}`;

  const maps = (
    <div className="maps">
      <MapCard quantity="temperature" snapshot={snapshot} config={config} dataset={dataset} selectedId={selectedId} onSelect={setSelectedId} instantLabel={instantLabel} replay={inReplay} />
      <MapCard quantity="humidity" snapshot={snapshot} config={config} dataset={dataset} selectedId={selectedId} onSelect={setSelectedId} instantLabel={instantLabel} replay={inReplay} />
    </div>
  );

  const irrigation = (
    <IrrigationCard
      config={config}
      dataset={dataset}
      state={planState}
      relay={inReplay ? null : relay}
      simulated={dataset === 'demo' && override !== 'auto'}
      override={override}
      onOverride={setOverride}
      instantLabel={inReplay ? `Estado no instante do replay: ${formatDateTime(at)}` : undefined}
      lastPeriodText={lastPeriodText}
    />
  );

  return (
    <main className="container">
      {noReadingsEver && dataset === 'real' && (
        <Notice kind="warn">
          <strong>Nenhuma leitura real recebida ainda.</strong> Neste modo nenhum dado simulado é exibido. Conecte os sensores ou envie leituras pela API de ingestão (veja “Dados e integração”).
        </Notice>
      )}

      {inReplay && range && (
        <ReplayPanel
          from={range.from}
          to={range.to}
          at={at}
          onAt={setAt}
          playing={playing}
          onPlaying={setPlaying}
          speed={speed}
          onSpeed={setSpeed}
          windowHours={windowHours}
          onWindowHours={(h) => {
            setWindowHours(h);
            setAt(replayAnchor - Math.min(h, 24) * HOUR / 2);
            setPlaying(false);
          }}
          irrigation={histPeriods}
          gaps={gaps}
          loading={hist.loading}
          hourly={!!hourly}
          toleranceMin={config.replay.toleranceMin}
          stepMs={hourly ? HOUR : 5 * MIN}
          onExit={exitReplay}
          error={hist.error?.message}
        />
      )}
      {replayOn && !inReplay && (
        <Notice>{hist.error ? <>Não foi possível carregar o histórico: {hist.error.message}</> : 'Carregando histórico para o replay…'}</Notice>
      )}

      <KpiGrid snapshot={snapshot} replay={inReplay} />

      {!tv && !replayOn && (
        <div className="card" style={{ padding: '0.7rem 1rem' }}>
          <div className="toolbar" style={{ justifyContent: 'space-between' }}>
            <span className="small dim">
              <Chip kind="ok">● Tempo real</Chip> Mapas e indicadores mostram as últimas leituras válidas. Use o replay para revisitar um instante do histórico.
            </span>
            <button type="button" className="btn" onClick={enterReplay}>
              ⏮ Replay histórico
            </button>
          </div>
        </div>
      )}

      {!tv && <AlertsCard snapshot={snapshot} alerts={config.alerts} />}
      {maps}

      {!tv && (
        <div className="card" style={{ padding: '0.7rem 1rem' }} aria-live="polite">
          {selected ? (
            <div className="toolbar" style={{ gap: '0.5rem 1rem' }}>
              <strong>
                {selected.sensor.id.toUpperCase()} · {selected.sensor.name}
              </strong>
              <FreshnessChip freshness={selected.freshness} replay={inReplay} />
              <span className="small dim">
                {selected.reading
                  ? `Leitura de ${formatDateTime(selected.reading.measuredAt)} (${inReplay ? 'no instante do replay' : formatAge(selected.ageMs)}) · posição ${selected.sensor.xM.toFixed(1)} m × ${selected.sensor.yM.toFixed(1)} m${selected.sensor.positionProvisional ? ' (provisória)' : ''}`
                  : 'Sem leitura disponível.'}
              </span>
              <button type="button" className="btn btn--sm btn--ghost" onClick={() => setSelectedId(null)}>
                Limpar seleção
              </button>
            </div>
          ) : (
            <span className="small mute">Toque ou clique em um sensor (nos mapas ou nos cartões) para destacar sua leitura, horário e situação de comunicação.</span>
          )}
        </div>
      )}

      {tv ? (
        <div className="tv-bottom">
          <SensorCards snapshot={snapshot} dataset={dataset} selectedId={selectedId} onSelect={setSelectedId} replay={inReplay} />
          {irrigation}
        </div>
      ) : (
        <>
          <SensorCards snapshot={snapshot} dataset={dataset} selectedId={selectedId} onSelect={setSelectedId} replay={inReplay} />
          <IndicatorsTable snapshot={snapshot} dataset={dataset} replay={inReplay} />
          <PeriodCard summary={summary} snapshot={snapshot} periodLabel={periodLabel} resolutionNote={hourly ? 'Baseado em médias horárias (mín./máx. dentro de cada hora).' : undefined} />
          {irrigation}
          <p className="tiny mute" style={{ margin: 0 }}>
            Sensores em posições provisórias e três pontos de medição não permitem afirmar a distribuição real de temperatura ou umidade.{' '}
            <button type="button" className="btn btn--sm btn--ghost" onClick={onGoConfig}>
              Ajustar posições
            </button>
          </p>
        </>
      )}
    </main>
  );
}
