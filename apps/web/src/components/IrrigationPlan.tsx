import { ROOM, fmtNum, formatDateTime } from '@orq/core';
import type { AppConfig, Dataset, RelayStatusDto } from '@orq/core';
import { Chip, OriginChip } from './ui';

export type PlanState = 'on' | 'off' | 'lost' | 'nodata';
export type SimOverride = 'auto' | 'on' | 'off' | 'lost';

const U = 10; // 1 m = 10 unidades do SVG

/** Tubulação ILUSTRATIVA: agrupa aspersores em fileiras pela coordenada y e liga cada fileira a um tronco à esquerda. */
function pipes(spr: AppConfig['irrigation']['sprinklers']): string[] {
  const rows: { y: number; xs: number[] }[] = [];
  for (const s of [...spr].sort((a, b) => a.yM - b.yM)) {
    const row = rows.find((r) => Math.abs(r.y - s.yM) < 0.75);
    if (row) row.xs.push(s.xM);
    else rows.push({ y: s.yM, xs: [s.xM] });
  }
  if (rows.length === 0) return [];
  const trunkX = 0.6;
  const ys = rows.map((r) => r.y);
  const mid = (Math.min(...ys) + Math.max(...ys)) / 2;
  const out = [`M0 ${mid * U} L${trunkX * U} ${mid * U}`, `M${trunkX * U} ${Math.min(...ys) * U} L${trunkX * U} ${Math.max(...ys) * U}`];
  for (const r of rows) {
    const xs = [...r.xs].sort((a, b) => a - b);
    out.push(`M${trunkX * U} ${r.y * U} L${xs[xs.length - 1]! * U} ${r.y * U}`);
  }
  return out;
}

const STATE_TEXT: Record<PlanState, { label: string; kind: 'ok' | 'warn' | 'bad' | 'plain'; detail: string }> = {
  on: { label: 'Relé ligado', kind: 'ok', detail: 'Estado informado pelo controlador como ligado.' },
  off: { label: 'Relé desligado', kind: 'plain', detail: 'Estado informado pelo controlador como desligado.' },
  lost: { label: 'Sem comunicação com o controlador', kind: 'bad', detail: 'Não se sabe se a bomba está ligada ou desligada.' },
  nodata: { label: 'Sem dados do controlador', kind: 'warn', detail: 'Nenhum estado do relé foi recebido ainda.' },
};

interface Props {
  config: AppConfig;
  dataset: Dataset;
  state: PlanState;
  relay: RelayStatusDto | null;
  simulated: boolean;
  override: SimOverride;
  onOverride: (o: SimOverride) => void;
  /** Texto do instante (replay). */
  instantLabel?: string;
  lastPeriodText?: string | null;
}

export function IrrigationCard({ config, dataset, state, relay, simulated, override, onOverride, instantLabel, lastPeriodText }: Props) {
  const spr = config.irrigation.sprinklers;
  const t = STATE_TEXT[state];
  const paths = pipes(spr);
  return (
    <section className="card" aria-label="Planta da irrigação">
      <div className="card__head">
        <div>
          <h2 className="card__title">Planta da irrigação</h2>
          <div className="card__sub hide-tv">
            {ROOM.lengthM} × {ROOM.widthM} m · circuito único · {spr.length} aspersor(es){config.irrigation.layoutProvisional ? ' ilustrativos (posições e alcance provisórios)' : ''}
          </div>
        </div>
        <div className="toolbar">
          <OriginChip dataset={dataset} />
          {simulated && <Chip kind="sim">Estado simulado na tela</Chip>}
          {config.irrigation.layoutProvisional && <Chip kind="warn">Layout provisório</Chip>}
        </div>
      </div>

      <div className="plan-wrap">
        <div className="relay-status">
          <Chip kind={t.kind}>{t.label}</Chip>
          <span className="small dim">{t.detail}</span>
          {instantLabel && <span className="small mute">{instantLabel}</span>}
        </div>

        <svg className="plan" data-state={state} viewBox={`-2 -2 ${ROOM.lengthM * U + 4} ${ROOM.widthM * U + 4}`} role="img" aria-label={`Planta de irrigação: ${t.label}`}>
          <rect x={0} y={0} width={ROOM.lengthM * U} height={ROOM.widthM * U} fill="none" stroke="#2a4250" strokeWidth={0.4} />
          {Array.from({ length: ROOM.lengthM - 1 }, (_, i) => (
            <line key={`gx${i}`} x1={(i + 1) * U} x2={(i + 1) * U} y1={0} y2={ROOM.widthM * U} stroke="rgba(255,255,255,0.05)" strokeWidth={0.2} />
          ))}
          {Array.from({ length: ROOM.widthM - 1 }, (_, i) => (
            <line key={`gy${i}`} y1={(i + 1) * U} y2={(i + 1) * U} x1={0} x2={ROOM.lengthM * U} stroke="rgba(255,255,255,0.05)" strokeWidth={0.2} />
          ))}
          {spr.map((s) => (
            <circle key={`r${s.id}`} className="spr-range" cx={s.xM * U} cy={s.yM * U} r={s.radiusM * U} />
          ))}
          {paths.map((d, i) => (
            <path key={i} className="pipe" d={d} />
          ))}
          {spr.map((s) => (
            <g key={s.id}>
              <circle className="spr-ring" cx={s.xM * U} cy={s.yM * U} r={s.radiusM * U * 0.9} />
              <circle className="spr-ring r2" cx={s.xM * U} cy={s.yM * U} r={s.radiusM * U * 0.9} />
              <circle className="spr-ring r3" cx={s.xM * U} cy={s.yM * U} r={s.radiusM * U * 0.9} />
              <circle className="spr-spray" cx={s.xM * U} cy={s.yM * U} r={Math.min(s.radiusM * U * 0.55, 9)} />
              <circle className="spr-dot" cx={s.xM * U} cy={s.yM * U} r={1.6} />
              <text className="spr-label" x={s.xM * U} y={s.yM * U + 4.6}>
                {s.label}
              </text>
            </g>
          ))}
          <text x={ROOM.lengthM * U} y={-0.6} textAnchor="end" fill="#7a9199" fontSize={1.8}>
            12 m
          </text>
          <text x={-0.6} y={ROOM.widthM * U} textAnchor="end" fill="#7a9199" fontSize={1.8} transform={`rotate(-90 -0.6 ${ROOM.widthM * U})`}>
            5 m
          </text>
        </svg>

        <p className="small dim" style={{ margin: 0 }}>
          <strong style={{ color: 'var(--text)' }}>Estado informado pelo controlador. Sem sensor de vazão, não há confirmação de passagem de água.</strong>
        </p>
        <p className="tiny mute hide-tv" style={{ margin: 0 }}>
          Posições, alcance e traçado das tubulações são ilustrativos (não medidos). A animação segue o estado do relé, não o fluxo de água.
        </p>

        <div className="split hide-tv" style={{ gap: '0.5rem' }}>
          <div className="small dim">
            {config.irrigation.informedSchedule && <div>{config.irrigation.informedSchedule}</div>}
            {relay?.lastStateAt && <div>Último estado informado: {formatDateTime(Date.parse(relay.lastStateAt))}</div>}
            {relay?.lastSeenAt && <div>Última mensagem do controlador: {formatDateTime(Date.parse(relay.lastSeenAt))}</div>}
            {lastPeriodText && <div>{lastPeriodText}</div>}
            <div>
              Alcance ilustrativo: {fmtNum(spr[0]?.radiusM ?? 0, 1)} m
            </div>
          </div>
          <div style={{ display: 'grid', gap: '0.4rem', justifyItems: 'start' }}>
            <button className="btn btn--sm" type="button" disabled title="Esta versão é somente de monitoramento: nenhum comando é enviado a equipamentos reais.">
              Ligar / desligar bomba
            </button>
            <span className="tiny mute">Indisponível: versão somente de monitoramento. Comandos exigirão validação do modelo do Sonoff e aprovação específica.</span>
          </div>
        </div>

        {dataset === 'demo' && (
          <div className="notice notice--sim hide-tv">
            <div className="small" style={{ marginBottom: '0.4rem' }}>
              <strong>Demonstração do estado do Sonoff</strong> — controle apenas visual, não envia comandos a nenhum equipamento.
            </div>
            <div className="seg" role="group" aria-label="Simular estado do relé (somente na demonstração)">
              {(
                [
                  ['auto', 'Automático (histórico simulado)'],
                  ['on', 'Simular ligado'],
                  ['off', 'Desligado'],
                  ['lost', 'Sem sinal'],
                ] as [SimOverride, string][]
              ).map(([v, l]) => (
                <button key={v} type="button" aria-pressed={override === v} onClick={() => onOverride(v)}>
                  {l}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
