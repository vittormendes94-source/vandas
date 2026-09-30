import type { ReactNode } from 'react';
import { evaluateAlerts, fmtNum, formatAge, formatDateTime, formatTimeSec } from '@orq/core';
import type { AppConfig, Dataset, PeriodSummary, QuantityStats, Snapshot } from '@orq/core';
import { CalcChip, Chip, FreshnessChip, OriginChip } from './ui';

function nameOf(snapshot: Snapshot, id: string): string {
  return snapshot.sensors.find((s) => s.sensor.id === id)?.sensor.name ?? id.toUpperCase();
}

function Kpi({ label, value, unit, foot, accent, secondary, title }: { label: string; value: string; unit?: string; foot?: ReactNode; accent?: 'green' | 'cyan'; secondary?: boolean; title?: string }) {
  return (
    <div className={`card kpi${accent ? ` kpi--accent-${accent}` : ''}${secondary ? ' kpi--secondary' : ''}`} title={title}>
      <div className="kpi__label">
        <span>{label}</span>
        <CalcChip />
      </div>
      <div className="kpi__value">
        {value}
        {unit && value !== '—' && <small>{unit}</small>}
      </div>
      <div className="kpi__foot">{foot}</div>
    </div>
  );
}

function range(stats: QuantityStats | null, snapshot: Snapshot, digits: number, unit: string): ReactNode {
  if (!stats) return 'Sem sensores com leitura válida';
  return (
    <>
      Máx {fmtNum(stats.max.value, digits)} ({stats.max.sensorId.toUpperCase()}) · Mín {fmtNum(stats.min.value, digits)} ({stats.min.sensorId.toUpperCase()}) {unit}
      {stats.n < snapshot.sensors.length && <> · {stats.n} de {snapshot.sensors.length} sensores</>}
    </>
  );
}

export function KpiGrid({ snapshot, replay }: { snapshot: Snapshot; replay: boolean }) {
  const { temperature: t, humidity: h, dpv, dewPoint } = snapshot;
  const { counts } = snapshot;
  const total = snapshot.sensors.length;
  const avgNote = 'Média dos pontos monitorados válidos; não representa exatamente todo o espaço.';
  return (
    <div className="kpi-grid">
      <Kpi label="Temperatura · média dos sensores" value={t ? fmtNum(t.mean, 1) : '—'} unit="°C" accent="green" title={avgNote} foot={range(t, snapshot, 1, '°C')} />
      <Kpi label="Umidade do ar · média dos sensores" value={h ? fmtNum(h.mean, 0) : '—'} unit="% UR" accent="cyan" title={avgNote} foot={range(h, snapshot, 0, '% UR')} />
      <Kpi label="Diferença entre pontos · temperatura" value={t && t.n > 1 ? fmtNum(t.spread, 1) : '—'} unit="°C" foot={t && t.n > 1 ? `Maior menos menor leitura (${nameOf(snapshot, t.max.sensorId)} − ${nameOf(snapshot, t.min.sensorId)})` : 'Requer ≥ 2 sensores válidos'} />
      <Kpi label="Diferença entre pontos · umidade" value={h && h.n > 1 ? fmtNum(h.spread, 0) : '—'} unit="p.p." foot={h && h.n > 1 ? `Pontos percentuais de UR (${nameOf(snapshot, h.max.sensorId)} − ${nameOf(snapshot, h.min.sensorId)})` : 'Requer ≥ 2 sensores válidos'} />
      <Kpi secondary label="DPV do ar · média dos pontos" value={dpv ? fmtNum(dpv.mean, 2) : '—'} unit="kPa" title="Calculado por sensor (Magnus) e depois promediado. DPV do AR, não da folha." foot={dpv ? `Por sensor: ${fmtNum(dpv.min.value, 2)} a ${fmtNum(dpv.max.value, 2)} kPa` : 'Sem sensores válidos'} />
      <Kpi secondary label="Ponto de orvalho · média dos pontos" value={dewPoint ? fmtNum(dewPoint.mean, 1) : '—'} unit="°C" foot={dewPoint ? `Por sensor: ${fmtNum(dewPoint.min.value, 1)} a ${fmtNum(dewPoint.max.value, 1)} °C` : 'Sem sensores válidos'} />
      <div className="card kpi kpi--secondary">
        <div className="kpi__label">
          <span>Sensores · situação</span>
          <Chip kind="plain">{replay ? 'no instante' : 'agora'}</Chip>
        </div>
        <div className="kpi__value">
          {counts.fresh}
          <small>de {total} {replay ? 'com leitura' : 'atualizados'}</small>
        </div>
        <div className="kpi__foot">
          {replay ? `${counts.unavailable} sem leitura no instante` : `${counts.delayed} atrasado(s) · ${counts.unavailable} sem comunicação`}
        </div>
      </div>
      <div className="card kpi kpi--secondary">
        <div className="kpi__label">
          <span>{replay ? 'Instante · última leitura usada' : 'Última leitura recebida'}</span>
        </div>
        <div className="kpi__value" style={{ fontSize: '1.5rem' }}>
          {snapshot.lastMeasuredAt ? formatTimeSec(snapshot.lastMeasuredAt) : '—'}
        </div>
        <div className="kpi__foot">
          {snapshot.lastMeasuredAt ? (
            <>
              Medida {replay ? formatDateTime(snapshot.lastMeasuredAt) : formatAge(snapshot.atMs - snapshot.lastMeasuredAt)}
              {!replay && snapshot.lastReceivedAt && <> · recebida {formatTimeSec(snapshot.lastReceivedAt)}</>}
            </>
          ) : (
            'Nenhuma leitura'
          )}
        </div>
      </div>
    </div>
  );
}

export function SensorCards({ snapshot, dataset, selectedId, onSelect, replay }: { snapshot: Snapshot; dataset: Dataset; selectedId: string | null; onSelect: (id: string | null) => void; replay: boolean }) {
  return (
    <div className="sensors">
      {snapshot.sensors.map((s) => {
        const r = s.reading;
        const cls = `sensor${s.freshness === 'delayed' ? ' sensor--delayed' : ''}${s.freshness === 'unavailable' ? ' sensor--unavailable' : ''}`;
        return (
          <button key={s.sensor.id} type="button" className={cls} aria-pressed={selectedId === s.sensor.id} onClick={() => onSelect(selectedId === s.sensor.id ? null : s.sensor.id)}>
            <div className="sensor__top">
              <span className="sensor__name">
                <em>{s.sensor.id.toUpperCase()}</em>
                {s.sensor.name}
              </span>
              <span className="toolbar">
                <OriginChip dataset={dataset} />
                <FreshnessChip freshness={s.freshness} replay={replay} />
              </span>
            </div>
            <div className="sensor__vals">
              <span>
                <b>{r ? fmtNum(r.temperatureC, 1) : '—'}</b> <span className="dim">°C</span>
              </span>
              <span>
                <b>{r ? fmtNum(r.humidityPct, 0) : '—'}</b> <span className="dim">% UR</span>
              </span>
            </div>
            <dl className="sensor__meta">
              <dt>DPV / orvalho</dt>
              <dd>
                {s.dpvKpa !== null ? `${fmtNum(s.dpvKpa, 2)} kPa` : '—'} · {s.dewPointC !== null ? `${fmtNum(s.dewPointC, 1)} °C` : '—'}
              </dd>
              <dt>Medido em</dt>
              <dd>{r ? `${formatDateTime(r.measuredAt)} (${replay ? 'no instante' : formatAge(s.ageMs)})` : 'sem leitura'}</dd>
              {!replay && (
                <>
                  <dt>Recebido em</dt>
                  <dd>{r ? formatDateTime(r.receivedAt) : '—'}</dd>
                </>
              )}
              {r?.batteryPct != null && (
                <>
                  <dt>Bateria</dt>
                  <dd>{fmtNum(r.batteryPct, 0)} %</dd>
                </>
              )}
              {(r?.linkQuality != null || r?.rssiDbm != null) && (
                <>
                  <dt>Sinal</dt>
                  <dd>{[r.linkQuality != null ? `LQI ${fmtNum(r.linkQuality, 0)}` : null, r.rssiDbm != null ? `${fmtNum(r.rssiDbm, 0)} dBm` : null].filter(Boolean).join(' · ')}</dd>
                </>
              )}
            </dl>
            {r?.timeBasis === 'received' && <div className="tiny" style={{ color: 'var(--amber)', marginTop: '0.3rem' }}>A origem não informou o horário da medição; usando o horário de recebimento.</div>}
            {s.freshness === 'delayed' && !replay && <div className="tiny" style={{ color: 'var(--amber)', marginTop: '0.3rem' }}>Leitura vencida: excluída das médias e do mapa.</div>}
            {s.freshness === 'unavailable' && !replay && <div className="tiny" style={{ color: 'var(--red)', marginTop: '0.3rem' }}>{r ? 'Sem comunicação: última leitura antiga, excluída das médias e do mapa.' : 'Nenhuma leitura recebida deste sensor.'}</div>}
            {s.sensor.positionProvisional && <div className="tiny mute" style={{ marginTop: '0.3rem' }}>Posição provisória ({fmtNum(s.sensor.xM, 1)} m, {fmtNum(s.sensor.yM, 1)} m)</div>}
          </button>
        );
      })}
    </div>
  );
}

export function IndicatorsTable({ snapshot, dataset, replay }: { snapshot: Snapshot; dataset: Dataset; replay: boolean }) {
  const hasBattery = snapshot.sensors.some((s) => s.reading?.batteryPct != null);
  const hasSignal = snapshot.sensors.some((s) => s.reading?.linkQuality != null || s.reading?.rssiDbm != null);
  return (
    <section className="card" aria-label="Indicadores por sensor">
      <div className="card__head">
        <div>
          <h2 className="card__title">Indicadores por sensor</h2>
          <div className="card__sub">DPV e ponto de orvalho calculados por sensor com a fórmula de Magnus (ver “Dados e integração”). DPV do ar, não da folha.</div>
        </div>
        <div className="toolbar">
          <OriginChip dataset={dataset} />
          <CalcChip />
        </div>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Sensor</th>
              <th className="num">Temp. (°C)</th>
              <th className="num">UR (%)</th>
              <th className="num">DPV (kPa)</th>
              <th className="num">Orvalho (°C)</th>
              <th>Medido em</th>
              {!replay && <th>Recebido em</th>}
              <th>Situação</th>
              {hasBattery && <th className="num">Bateria (%)</th>}
              {hasSignal && <th>Sinal</th>}
            </tr>
          </thead>
          <tbody>
            {snapshot.sensors.map((s) => {
              const r = s.reading;
              return (
                <tr key={s.sensor.id}>
                  <td>
                    <b>{s.sensor.id.toUpperCase()}</b> {s.sensor.name}
                  </td>
                  <td className="num">{r ? fmtNum(r.temperatureC, 1) : '—'}</td>
                  <td className="num">{r ? fmtNum(r.humidityPct, 1) : '—'}</td>
                  <td className="num">{fmtNum(s.dpvKpa, 2)}</td>
                  <td className="num">{fmtNum(s.dewPointC, 1)}</td>
                  <td>{r ? formatTimeSec(r.measuredAt) : '—'}</td>
                  {!replay && <td>{r ? formatTimeSec(r.receivedAt) : '—'}</td>}
                  <td>
                    <FreshnessChip freshness={s.freshness} replay={replay} />
                  </td>
                  {hasBattery && <td className="num">{r?.batteryPct != null ? fmtNum(r.batteryPct, 0) : '—'}</td>}
                  {hasSignal && <td>{r && (r.linkQuality != null || r.rssiDbm != null) ? [r.linkQuality != null ? `LQI ${r.linkQuality}` : '', r.rssiDbm != null ? `${r.rssiDbm} dBm` : ''].filter(Boolean).join(' · ') : '—'}</td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="tiny mute" style={{ margin: '0.6rem 0 0' }}>
        Médias e diferenças usam apenas os pontos monitorados com leitura válida; não afirmam representar todo o espaço.
        {!hasBattery && !hasSignal && ' Bateria e qualidade de sinal aparecem aqui somente quando a integração as fornecer.'}
      </p>
    </section>
  );
}

export function PeriodCard({ summary, snapshot, periodLabel, resolutionNote }: { summary: PeriodSummary | null; snapshot: Snapshot; periodLabel: string; resolutionNote?: string }) {
  const item = (label: string, e: { value: number; sensorId: string; t: number } | undefined, digits: number, unit: string) => (
    <div>
      <div className="tiny mute">{label}</div>
      <div style={{ fontWeight: 700, fontSize: '1.1rem' }}>{e ? `${fmtNum(e.value, digits)} ${unit}` : '—'}</div>
      {e && (
        <div className="tiny dim">
          {nameOf(snapshot, e.sensorId)} · {formatDateTime(e.t)}
        </div>
      )}
    </div>
  );
  return (
    <section className="card" aria-label="Máximas e mínimas no período">
      <div className="card__head">
        <div>
          <h2 className="card__title">Máximas e mínimas · {periodLabel}</h2>
          <div className="card__sub">Extremos das leituras dos sensores no período (não são médias do espaço). {resolutionNote}</div>
        </div>
        <CalcChip />
      </div>
      {!summary || !summary.temperature ? (
        <div className="empty">Sem leituras no período.</div>
      ) : (
        <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(4, minmax(0,1fr))' }}>
          {item('Temperatura máxima', summary.temperature.max, 1, '°C')}
          {item('Temperatura mínima', summary.temperature.min, 1, '°C')}
          {item('Umidade máxima', summary.humidity?.max, 0, '% UR')}
          {item('Umidade mínima', summary.humidity?.min, 0, '% UR')}
        </div>
      )}
    </section>
  );
}

export function AlertsCard({ snapshot, alerts }: { snapshot: Snapshot; alerts: AppConfig['alerts'] }) {
  const hits = evaluateAlerts(snapshot, alerts);
  const configured = [alerts.temperature, alerts.humidity, alerts.dpv].some((l) => l.min !== null || l.max !== null);
  const names = { temperature: 'Temperatura', humidity: 'Umidade', dpv: 'DPV' } as const;
  const units = { temperature: '°C', humidity: '% UR', dpv: 'kPa' } as const;
  if (!configured) {
    return (
      <div className="notice">
        <strong>Limites de alerta:</strong> nenhum configurado. Defina seus próprios limites em Configurações — o sistema não impõe faixas “ideais” universais.
      </div>
    );
  }
  return (
    <div className={`notice${hits.length ? ' notice--warn' : ''}`}>
      <div className="toolbar" style={{ marginBottom: hits.length ? '0.35rem' : 0 }}>
        <strong>{hits.length ? `${hits.length} leitura(s) fora dos limites configurados` : 'Nenhuma leitura válida fora dos limites configurados'}</strong>
        {alerts.demonstrative && <Chip kind="sim">Limites demonstrativos — defina os seus</Chip>}
      </div>
      {hits.length > 0 && (
        <ul className="list">
          {hits.map((h, i) => (
            <li key={i}>
              {nameOf(snapshot, h.sensorId)} · {names[h.kind]} {fmtNum(h.value, h.kind === 'dpv' ? 2 : 1)} {units[h.kind]} {h.direction === 'above' ? 'acima' : 'abaixo'} do limite configurado ({fmtNum(h.limit, h.kind === 'dpv' ? 2 : 1)} {units[h.kind]})
            </li>
          ))}
        </ul>
      )}
      <div className="tiny mute" style={{ marginTop: '0.3rem' }}>
        Aviso sobre valores configurados por você; não classifica a saúde das plantas. Sensores atrasados ou sem comunicação não são avaliados.
      </div>
    </div>
  );
}
