import { useEffect, useMemo, useState } from 'react';
import {
  HOUR,
  MIN,
  bucketsFromHistory,
  buildSnapshot,
  fmtNum,
  formatAge,
  formatIrrigationDuration,
  formatTime,
  irrigationAdvice,
  activeAlerts,
  localDateTimeString,
  readingFromDto,
  simplePump,
  simpleStatus,
  startOfLocalDay,
  todayExtremes,
  trendOf,
  valueTone,
} from '@orq/core';
import type { AppConfig, AutomationStatusDto, Bucket, IrrigationAdvice, IrrigationsSummary, MeanPoint, Quantity, Reading, SimpleLevel, SimpleStatus, Snapshot, Trend, ValueTone } from '@orq/core';
import { SmartMap } from '../components/SmartMap';
import { PushToggle } from '../components/PushToggle';
import { Forecast, OutdoorNow, useWeather } from '../components/Weather';
import { useHistory } from '../hooks/useHistory';
import { api } from '../lib/api';
import type { LiveState } from '../hooks/useLive';

/**
 * Painel da TV (65") e visão para quem não é técnico: uma tela fixa, 3 colunas — temperatura, umidade com os
 * aspersores, irrigação. Mesmos dados e regras do painel completo: nada é inventado.
 */
export function Simple({ live, nowMs, onFull }: { live: LiveState & { refresh?: () => void }; nowMs: number; onFull: () => void }) {
  const data = live.data;
  const refreshLive = live.refresh;
  // Bomba quase em tempo real sem gastar cota: o servidor só lê o eWeLink quando alguém abre/volta ao painel
  // no máximo 1 leitura a cada 20 s.
  useEffect(() => {
    const ping = () => {
      if (document.visibilityState === 'hidden') return;
      api.pumpRefresh().then((r) => { if (r.ran) refreshLive?.(); }).catch(() => {});
    };
    ping();
    document.addEventListener('visibilitychange', ping);
    return () => document.removeEventListener('visibilitychange', ping);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const config = data?.config ?? null;

  // Últimas 24 h, ancoradas a cada 5 min (não recarrega a cada atualização da tela).
  const anchor = Math.floor(nowMs / (5 * MIN)) * 5 * MIN;
  const range = useMemo(() => (anchor > 0 ? { from: anchor - 24 * HOUR, to: anchor } : null), [anchor]);
  const hist = useHistory(range);
  // Se já há medições de mais de 24 h, o gráfico usa as médias por hora de até 7 dias (mais leve e suave).
  const rawFirst = hist.data?.series.reduce((m, se) => Math.min(m, (se.rows[0]?.[0] as number | undefined) ?? Infinity), Infinity) ?? Infinity;
  const longRange = useMemo(() => (range && rawFirst < range.from + HOUR ? { from: range.to - 7 * 24 * HOUR, to: range.to } : null), [range, rawFirst]);
  const histLong = useHistory(longRange);
  const weather = useWeather();
  const sensorIds = useMemo(() => config?.sensors.map((s) => s.id) ?? [], [config]);
  const longFirst = histLong.data?.series.reduce((m, se) => Math.min(m, (se.rows[0]?.[0] as number | undefined) ?? Infinity), Infinity) ?? Infinity;
  // Só usa os 7 dias se as médias por hora realmente cobrem mais que as últimas 24 h.
  const useLong = !!longRange && !!histLong.data && longFirst < longRange.to - 26 * HOUR;
  const buckets = useMemo(() => {
    const h = useLong ? histLong.data : hist.data;
    return h ? bucketsFromHistory(h) : [];
  }, [useLong, histLong.data, hist.data]);
  const bin = useLong ? HOUR : 15 * MIN;
  const tLine = useMemo(() => holdMean(buckets, 'temperature', sensorIds, bin), [buckets, sensorIds, bin]);
  const hLine = useMemo(() => holdMean(buckets, 'humidity', sensorIds, bin), [buckets, sensorIds, bin]);
  const chartFrom = useLong ? longRange!.from : (range?.from ?? 0);
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
  const pump = simplePump(data.pump, nowMs);
  const running = pump.tone === 'on' ? data.irrigations.last.find((e) => e.endedAt === null) : undefined;
  const runningMs = running ? nowMs - Date.parse(running.startedAt) : 0;
  // margem de 2 min: a bomba é lida a cada 2 min
  const overrun = !!running && runningMs > (config.pump.maxRunMin + 2) * MIN;
  const hottest = snap.sensors.reduce<number | null>((m, x) => (x.valid && x.reading ? Math.max(m ?? -Infinity, x.reading.temperatureC) : m), null);
  // Sol: só vale se a previsão foi buscada há menos de 1 h.
  const sunFresh = !!weather?.data && !!weather.fetchedAt && nowMs - Date.parse(weather.fetchedAt) < HOUR;
  const advice = irrigationAdvice({
    rules: config.irrigationRules,
    insideMaxC: hottest,
    sunWm2: sunFresh ? weather!.data!.current.directRadiationWm2 : null,
    nowLocal: localDateTimeString(nowMs),
    hours: weather?.data?.hours,
  });
  const badRun = pump.tone === 'on' && advice.state === 'no';
  const lc = data.automation.lastCommand;
  const offFailed = pump.tone === 'on' && !!lc && lc.action === 'off' && !lc.ok;
  const status: SimpleStatus = offFailed
    ? { level: 'bad', headline: 'Não consegui desligar a bomba', details: [`Motivo para desligar: ${lc!.reason}.`, lc!.error ?? 'O Sonoff não respondeu.', 'Confira a bomba no local.'] }
    : overrun
    ? {
        level: 'bad',
        headline: `Bomba ligada há ${formatIrrigationDuration(runningMs)}`,
        details: [`O tempo previsto de irrigação é ${config.pump.maxRunMin} min. Confira se a bomba desligou (risco de esvaziar a caixa d'água).`],
      }
    : badRun
      ? { level: 'bad', headline: 'Irrigando fora das regras', details: [...advice.reasons, 'Risco de queimar plantas e flores.'] }
      : simpleStatus(snap, config, nowMs);

  return (
    <main className="tvp">
      <header className={`tvp__status tvp__status--${status.level}`} role="status">
        <div className="tvp__logo" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 21V11M12 11c0-4 2.5-6.5 7-7-.2 4.6-2.8 7-7 7zM12 14c0-3-2-5-6.5-5.5C5.8 12 8 14 12 14z" />
          </svg>
        </div>
        <div className="tvp__status-text">
          <div className="tvp__brand">Orquidário Inteligente</div>
          <div className="tvp__headline">
            <span className="tvp__status-icon" aria-hidden="true">
              <StatusIcon level={status.level} />
            </span>
            {status.headline}
          </div>
          <div className="tvp__details">
            {status.details.slice(0, 2).map((d) => (
              <span key={d}>{d}</span>
            ))}
          </div>
        </div>
        <OutdoorNow w={weather} />
        <div className="tvp__right">
          <Clock nowMs={nowMs} />
          <div className="tvp__updated">{snap.lastMeasuredAt ? `Última leitura ${formatAge(nowMs - snap.lastMeasuredAt)}` : 'Sem leituras ainda'}</div>
          <PushToggle />
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
          from={chartFrom}
          longChart={useLong}
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
          from={chartFrom}
          longChart={useLong}
          to={range?.to ?? 0}
          nowMs={nowMs}
          today={today && today.hMin !== null ? [today.hMin, today.hMax!] : null}
          pumpOn={pump.tone === 'on'}
        />
        <IrrigationColumn pump={pump} summary={data.irrigations} nowMs={nowMs} maxRunMin={config.pump.maxRunMin} overrun={overrun} advice={advice} automation={data.automation} />
      </div>
      <Forecast w={weather} nowMs={nowMs} />
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
  longChart?: boolean;
}) {
  const u = UNIT[p.quantity];
  const stats = p.quantity === 'temperature' ? p.snap.temperature : p.snap.humidity;
  const mean = stats?.mean ?? null;
  const limits = activeAlerts(p.config, p.nowMs)[p.quantity];
  const tone = valueTone(mean, limits);
  const trend = trendOf(p.line, u.threshold, p.nowMs);
  const fresh = p.snap.counts.fresh;
  const never = p.snap.lastMeasuredAt === null;
  // Período do gráfico se adapta às medições: do primeiro ponto até agora, entre 1 h e 24 h.
  const first = p.line.length ? p.line[0]!.t : p.to;
  const sparkFrom = Math.max(p.from, Math.min(first, p.to - HOUR));
  const spanH = (p.to - sparkFrom) / HOUR;
  const sparkLabel = spanH > 36 ? `${Math.round(spanH / 24)} dias` : `${Math.max(1, Math.round(spanH))} h`;
  return (
    <section className={`tvp__col tvp__col--${p.quantity}`} aria-label={p.title}>
      <SmartMap
        quantity={p.quantity}
        snapshot={p.snap}
        config={p.config}
        pumpOn={p.pumpOn ?? false}
        head={
          <>
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
          </>
        }
        footer={
          <>
      {p.line.length < 2 ? (
        <div className="tvp__spark-box tvp__spark-box--empty">
          <span>O gráfico das últimas 24 horas aparece aqui depois das primeiras leituras.</span>
        </div>
      ) : (
        <div className="tvp__spark-box">
          <Spark points={p.line.filter((x) => x.t >= sparkFrom)} from={sparkFrom} to={p.to} color={p.quantity === 'temperature' ? '#ff9f43' : '#38b6ff'} suffix={u.suffix} digits={u.digits} gapMs={p.longChart ? 3 * HOUR : 45 * MIN} />
          <div className="tvp__spark-axis" aria-hidden="true">
            <span>{spanH > 36 ? new Date(sparkFrom).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit' }) : formatTime(sparkFrom)}</span>
            <span>{spanH > 36 ? new Date((sparkFrom + p.to) / 2).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit' }) : formatTime((sparkFrom + p.to) / 2)}</span>
            <span>agora →</span>
          </div>
          <div className="tvp__spark-label">
            <span>Média dos sensores · últimas {sparkLabel}</span>
            {p.today && (
              <span>
                Hoje: mín <b>{fmtNum(p.today[0], u.digits)}{u.suffix}</b> · máx <b>{fmtNum(p.today[1], u.digits)}{u.suffix}</b>
              </span>
            )}
          </div>
        </div>
      )}
          </>
        }
      />
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

function IrrigationColumn({
  pump,
  summary,
  nowMs,
  maxRunMin,
  overrun,
  advice,
  automation,
}: {
  pump: ReturnType<typeof simplePump>;
  summary: IrrigationsSummary;
  nowMs: number;
  maxRunMin: number;
  overrun: boolean;
  advice: IrrigationAdvice;
  automation: AutomationStatusDto;
}) {
  const dayStart = startOfLocalDay(nowMs);
  return (
    <section className="tvp__col tvp__col--irr" aria-label="Irrigação">
      <div className="tvp__label">
        <SprinklerIcon />
        Irrigação
      </div>
      <div className={`tvp__pump tvp__pump--${pump.tone}${overrun ? ' tvp__pump--over' : ''}`}>
        <svg className="tvp__pump-icon" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 2.5c-3.6 4.6-6.5 8.3-6.5 11.6A6.5 6.5 0 0 0 12 20.6a6.5 6.5 0 0 0 6.5-6.5C18.5 10.8 15.6 7.1 12 2.5z" fill="currentColor" />
        </svg>
        <div>
          <div className="tvp__pump-label">{pump.label}</div>
          <div className="tvp__small">{overrun ? `Passou do tempo previsto (${maxRunMin} min)` : pump.detail}</div>
        </div>
      </div>

      <AdviceCard advice={advice} automation={automation} nowMs={nowMs} />
      <AutomationCard a={automation} />

      {pump.tone === 'none' && summary.last.length === 0 ? (
        // Com a automação ligada, o cartão dela já diz o que falta; a lista só aparece no modo desligado.
        automation.mode === 'desligado' && (
        <div className="tvp__soon">
          <div className="tvp__list-title">Quando a bomba for conectada, aparece aqui</div>
          <ul>
            <li>se a bomba está ligada agora</li>
            <li>quantas vezes irrigou hoje e por quanto tempo</li>
            <li>horário e duração das últimas irrigações</li>
          </ul>
        </div>
        )
      ) : (
        <>
          <div className="tvp__today-line">
            Hoje: <b>{summary.todayCount}</b> irrigaç{summary.todayCount === 1 ? 'ão' : 'ões'} · <b>{summary.todayCount ? formatIrrigationDuration(summary.todayTotalMs) : '0 min'}</b> no total
          </div>

          <div className="tvp__list-title">Últimas irrigações</div>
          {summary.last.length === 0 ? (
            <div className="tvp__empty">Nenhuma irrigação registrada ainda.</div>
          ) : (
            <ol className="tvp__list">
              {summary.last.slice(0, 5).map((e) => {
                const start = Date.parse(e.startedAt);
                const running = e.endedAt === null;
                return (
                  <li key={e.startedAt} className={running ? `tvp__list-running${overrun ? ' tvp__list-over' : ''}` : e.durationMs > (maxRunMin + 2) * MIN ? 'tvp__list-long' : undefined}>
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
          <div className="tvp__footnote">Tempo previsto: {maxRunMin} min por irrigação · precisão de ~2 min</div>
        </>
      )}
    </section>
  );
}

/** Automação: modo, o que está fazendo e os horários de hoje. */
function AutomationCard({ a }: { a: AutomationStatusDto }) {
  if (a.mode === 'desligado') return null;
  const title = a.mode === 'automatico' ? 'Irrigação automática' : 'Proteção automática';
  const failed = a.lastCommand && !a.lastCommand.ok;
  const line = a.blockedBy ?? (failed ? `Falha ao ${a.lastCommand!.action === 'on' ? 'ligar' : 'desligar'}: ${a.lastCommand!.error}` : a.note);
  const label = { pendente: '', feito: '✓', adiado: 'adiada', pulado: 'pulada' } as const;
  return (
    <div className={`tvp__auto${a.ready ? '' : ' tvp__auto--wait'}${failed ? ' tvp__auto--fail' : ''}`}>
      <div className="tvp__auto-title">
        <span className="tvp__auto-dot" aria-hidden="true" />
        {title}
      </div>
      {line && <div className="tvp__auto-note">{line}</div>}
      {a.slots.length > 0 && (
        <div className="tvp__auto-slots">
          {a.slots.map((s) => (
            <span key={s.time} className={`tvp__slot tvp__slot--${s.status}`} title={s.detail ?? undefined}>
              {s.time} {label[s.status]}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** "Pode irrigar agora?" pelas regras do dono (Configurações → Regras de irrigação). */
function AdviceCard({ advice, automation, nowMs }: { advice: IrrigationAdvice; automation: AutomationStatusDto; nowMs: number }) {
  // No modo automático, "pode irrigar" também depende dos horários: fora deles, mostra o próximo.
  const nowHm = new Date(nowMs).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  const slots = automation.mode === 'automatico' ? automation.slots : [];
  const inSlot = slots.some((s) => (s.status === 'pendente' || s.status === 'adiado') && toMin(nowHm) >= toMin(s.time) && toMin(nowHm) - toMin(s.time) <= 30);
  const nextSlot = slots.map((s) => s.time).find((t) => toMin(t) > toMin(nowHm)) ?? (slots[0] ? `amanhã ${slots[0].time}` : null);
  if (advice.state !== 'no' && slots.length > 0 && !inSlot) {
    return (
      <div className="tvp__advice tvp__advice--unknown" role="status">
        <svg className="tvp__advice-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 7.5V12l3 2M12 3.5a8.5 8.5 0 1 0 0 17a8.5 8.5 0 1 0 0-17z" />
        </svg>
        <div>
          <div className="tvp__advice-title">Fora do horário de irrigação</div>
          <div className="tvp__advice-detail">{advice.state === 'ok' ? 'Temperatura e sol dentro das regras' : 'Regras sem dados agora'}</div>
          {nextSlot && <div className="tvp__advice-next">Próxima irrigação: {nextSlot}</div>}
        </div>
      </div>
    );
  }
  const title = { ok: 'Pode irrigar agora', no: 'Não irrigar agora', unknown: 'Regras sem dados agora' }[advice.state];
  const icon = { ok: 'M5 12.5l4.5 4.5L19 7.5', no: 'M7 7l10 10M17 7L7 17', unknown: 'M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5V14M12 17.5v.1' }[advice.state];
  const detail =
    advice.state === 'no'
      ? advice.reasons
      : advice.state === 'ok'
        ? [advice.missing.length ? `Dentro das regras que deu para avaliar (${advice.missing.join(', ')})` : 'Temperatura e sol dentro das regras']
        : [advice.missing.join(' · ') || 'Nenhuma regra definida em Configurações'];
  const next = advice.state !== 'no' ? null : advice.nextGood ? `Próximo horário bom: ${advice.nextGood}` : advice.reasons.every((r) => r.startsWith('Estufa')) ? 'Aguarde a estufa esfriar' : null;
  return (
    <div className={`tvp__advice tvp__advice--${advice.state}`} role="status">
      <svg className="tvp__advice-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d={icon} />
      </svg>
      <div>
        <div className="tvp__advice-title">{title}</div>
        <div className="tvp__advice-detail">{detail.join(' · ')}</div>
        {next && <div className="tvp__advice-next">{next}</div>}
      </div>
    </div>
  );
}

/** Linha das últimas 24 h (média dos sensores). Trechos sem todos os sensores ficam em branco, como no painel. */
/**
 * Média dos sensores por intervalo, mantendo o último valor de cada sensor por até 1 h (o SwitchBot só grava
 * quando o valor muda; sem isso a linha fica cheia de buracos). Só entra o intervalo com todos os sensores.
 */
function holdMean(buckets: Bucket[], q: Quantity, ids: string[], bin: number): MeanPoint[] {
  if (!buckets.length || !ids.length) return [];
  const HOLD = HOUR;
  const per = new Map<string, Bucket[]>();
  for (const b of buckets) per.set(b.sensorId, [...(per.get(b.sensorId) ?? []), b]);
  for (const v of per.values()) v.sort((a, b) => a.t - b.t);
  const t0 = Math.floor(Math.min(...buckets.map((b) => b.t)) / bin) * bin;
  const t1 = Math.max(...buckets.map((b) => b.t));
  const idx = new Map(ids.map((id) => [id, -1]));
  const out: MeanPoint[] = [];
  for (let t = t0; t <= t1 + bin; t += bin) {
    let sum = 0;
    let n = 0;
    for (const id of ids) {
      const arr = per.get(id) ?? [];
      let i = idx.get(id)!;
      while (i + 1 < arr.length && arr[i + 1]!.t < t + bin) i++;
      idx.set(id, i);
      const b = arr[i];
      if (b && t + bin - b.t <= HOLD + bin) {
        sum += q === 'temperature' ? b.tAvg : b.hAvg;
        n++;
      }
    }
    if (n === ids.length) out.push({ t: Math.min(t + bin, t1), v: sum / n } as MeanPoint);
  }
  return out;
}

/**
 * Linha das últimas horas (média dos sensores), suavizada, com tendência e projeção.
 * Tendência: reta de mínimos quadrados sobre as últimas 3 h; projeção: essa reta estendida por até 2 h,
 * tracejada. É uma extrapolação simples (não considera sol, chuva ou irrigação).
 */
function Spark({ points, from, to, color, suffix, digits, gapMs = 45 * MIN }: { points: MeanPoint[]; from: number; to: number; color: string; suffix: string; digits: number; gapMs?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  if (points.length < 2 || to <= from) return <div className="tvp__spark tvp__spark--empty">sem dados ainda</div>;
  // média móvel de 3 pontos
  const sm = points.map((p, i) => {
    const w = points.slice(Math.max(0, i - 1), i + 2);
    return { t: p.t, v: w.reduce((a, b) => a + b.v, 0) / w.length };
  });
  // tendência das últimas 3 h
  const recent = sm.filter((p) => p.t >= to - 3 * HOUR);
  let slope = 0;
  if (recent.length >= 3) {
    const mt = recent.reduce((a, p) => a + p.t, 0) / recent.length;
    const mv = recent.reduce((a, p) => a + p.v, 0) / recent.length;
    const num = recent.reduce((a, p) => a + (p.t - mt) * (p.v - mv), 0);
    const den = recent.reduce((a, p) => a + (p.t - mt) ** 2, 0);
    slope = den > 0 ? num / den : 0;
  }
  const horizon = Math.max(30 * MIN, Math.min(2 * HOUR, (to - from) / 3));
  const last = sm[sm.length - 1]!;
  const end = to + horizon;
  const projected = last.v + slope * (end - last.t);
  const vs = [...sm.map((p) => p.v), projected];
  let lo = Math.min(...vs);
  let hi = Math.max(...vs);
  if (hi - lo < 1) {
    const mid = (hi + lo) / 2;
    lo = mid - 0.5;
    hi = mid + 0.5;
  }
  const W = 300;
  const H = 60;
  const x = (t: number) => ((t - from) / (end - from)) * W;
  const y = (v: number) => H - 6 - ((v - lo) / (hi - lo)) * (H - 12);
  // curva suave (Catmull-Rom → Bézier), quebrando em lacunas > 45 min
  let d = '';
  sm.forEach((p, i) => {
    const gap = i > 0 && p.t - sm[i - 1]!.t > gapMs;
    if (i === 0 || gap) {
      d += `M${x(p.t).toFixed(1)} ${y(p.v).toFixed(1)} `;
      return;
    }
    const p0 = sm[Math.max(0, i - 2)]!;
    const p1 = sm[i - 1]!;
    const p3 = sm[Math.min(sm.length - 1, i + 1)]!;
    const c1x = x(p1.t) + (x(p.t) - x(p0.t)) / 6;
    const c1y = y(p1.v) + (y(p.v) - y(p0.v)) / 6;
    const c2x = x(p.t) - (x(p3.t) - x(p1.t)) / 6;
    const c2y = y(p.v) - (y(p3.v) - y(p1.v)) / 6;
    d += `C${c1x.toFixed(1)} ${c1y.toFixed(1)} ${c2x.toFixed(1)} ${c2y.toFixed(1)} ${x(p.t).toFixed(1)} ${y(p.v).toFixed(1)} `;
  });
  // preenchimento: um polígono por trecho contínuo
  let fill = '';
  let segStart = 0;
  sm.forEach((p, i) => {
    const end = i === sm.length - 1 || sm[i + 1]!.t - p.t > gapMs;
    if (!end) return;
    const seg = sm.slice(segStart, i + 1);
    if (seg.length > 1) fill += `M${x(seg[0]!.t).toFixed(1)} ${H} ${seg.map((q) => `L${x(q.t).toFixed(1)} ${y(q.v).toFixed(1)}`).join(' ')} L${x(p.t).toFixed(1)} ${H} Z `;
    segStart = i + 1;
  });
  const gid = `g${color.replace(/[^a-z]/gi, '')}`;
  return (
    <div
      className="tvp__spark-wrap"
      onPointerMove={(e) => {
        const r = (e.currentTarget.querySelector('.tvp__spark-plot') as HTMLElement).getBoundingClientRect();
        const f = (e.clientX - r.left) / r.width;
        const t = from + f * (end - from);
        if (t > to) return setHover(null);
        let bi = 0;
        sm.forEach((p, i) => {
          if (Math.abs(p.t - t) < Math.abs(sm[bi]!.t - t)) bi = i;
        });
        setHover(bi);
      }}
      onPointerLeave={() => setHover(null)}
    >
      <div className="tvp__spark-yaxis" aria-hidden="true">
        {[hi, (hi + lo) / 2, lo].map((v, i) => (
          <span key={i} style={{ top: `${(y(v) / H) * 100}%` }}>
            {fmtNum(v, digits)}
            {suffix}
          </span>
        ))}
      </div>
      <div className="tvp__spark-plot">
      <svg className="tvp__spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={color} stopOpacity="0.35" />
            <stop offset="1" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <rect x={x(to)} y="0" width={W - x(to)} height={H} fill="rgba(255,255,255,0.035)" />
        <line x1={x(to)} x2={x(to)} y1="0" y2={H} stroke="rgba(255,255,255,0.25)" strokeDasharray="2 3" vectorEffect="non-scaling-stroke" />
        <path d={fill} fill={`url(#${gid})`} stroke="none" />
        <path d={d} fill="none" stroke={color} strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        <line x1={x(last.t)} y1={y(last.v)} x2={x(end)} y2={y(projected)} stroke={color} strokeWidth="2.5" strokeDasharray="6 5" opacity="0.8" vectorEffect="non-scaling-stroke" />
        {[hi, (hi + lo) / 2, lo].map((v, i) => (
          <line key={i} x1="0" x2={W} y1={y(v)} y2={y(v)} stroke="rgba(255,255,255,0.08)" vectorEffect="non-scaling-stroke" />
        ))}
        {hover !== null && sm[hover] && <line x1={x(sm[hover]!.t)} x2={x(sm[hover]!.t)} y1="0" y2={H} stroke="rgba(255,255,255,0.6)" vectorEffect="non-scaling-stroke" />}
      </svg>
      {hover !== null && sm[hover] && (
        <span className="tvp__spark-tip" style={{ left: `${(x(sm[hover]!.t) / W) * 100}%`, top: `${(y(sm[hover]!.v) / H) * 100}%` }}>
          <b>
            {fmtNum(sm[hover]!.v, digits)}
            {suffix}
          </b>
          {new Date(sm[hover]!.t).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'short', hour: '2-digit', minute: '2-digit' })}
        </span>
      )}
      <span className="tvp__spark-proj" style={{ top: `${(y(projected) / H) * 100}%` }}>
        {fmtNum(projected, digits)}
        {suffix}
      </span>
      <span className="tvp__spark-future">previsão {Math.round(horizon / MIN) >= 60 ? `${Math.round(horizon / HOUR)} h` : `${Math.round(horizon / MIN)} min`}</span>
      </div>
    </div>
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
