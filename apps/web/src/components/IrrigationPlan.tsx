import { ROOM, formatAge, formatDateTime } from '@orq/core';
import type { AppConfig, PumpDto } from '@orq/core';
import { Chip } from './ui';

export type PlanState = 'on' | 'off' | 'lost';

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
  for (const r of rows) out.push(`M${trunkX * U} ${r.y * U} L${Math.max(...r.xs) * U} ${r.y * U}`);
  return out;
}

export function pumpView(p: PumpDto, nowMs: number): { plan: PlanState; label: string; kind: 'ok' | 'warn' | 'bad' | 'plain'; detail: string } {
  const seen = p.seenAt ? ` · confirmado ${formatAge(nowMs - Date.parse(p.seenAt))}` : '';
  if (p.comm === 'ok' && p.state === 'on') return { plan: 'on', label: 'Bomba ligada', kind: 'ok', detail: `Estado informado pelo Sonoff${seen}.` };
  if (p.comm === 'ok' && p.state === 'off') return { plan: 'off', label: 'Bomba desligada', kind: 'plain', detail: `Estado informado pelo Sonoff${seen}.` };
  if (p.comm === 'not_linked') return { plan: 'lost', label: 'Bomba não vinculada', kind: 'warn', detail: 'Escolha o Sonoff da bomba em Configurações depois de conectar o eWeLink.' };
  if (p.comm === 'no_data') return { plan: 'lost', label: 'Aguardando o Sonoff', kind: 'warn', detail: 'O Sonoff vinculado ainda não apareceu na leitura do eWeLink.' };
  if (p.comm === 'offline') return { plan: 'lost', label: 'Sonoff sem comunicação', kind: 'bad', detail: 'O eWeLink informa o Sonoff como offline: não se sabe se a bomba está ligada ou desligada.' };
  return { plan: 'lost', label: 'Sem leitura recente', kind: 'bad', detail: `A leitura do eWeLink está parada${p.seenAt ? ` desde ${formatDateTime(Date.parse(p.seenAt))}` : ''}: estado desconhecido.` };
}

export function IrrigationCard({ config, pump, nowMs }: { config: AppConfig; pump: PumpDto; nowMs: number }) {
  const spr = config.irrigation.sprinklers;
  const v = pumpView(pump, nowMs);
  const paths = pipes(spr);
  return (
    <section className="card" aria-label="Irrigação">
      <div className="card__head">
        <div>
          <h2 className="card__title">Irrigação</h2>
          <div className="card__sub hide-tv">
            {ROOM.lengthM} × {ROOM.widthM} m · {spr.length} aspersor(es){config.irrigation.layoutProvisional ? ' · posições ilustrativas' : ''}
            {pump.deviceName ? ` · ${pump.deviceName}` : ''}
          </div>
        </div>
        <Chip kind={v.kind}>{v.label}</Chip>
      </div>

      <div className="plan-wrap">
        <svg className="plan" data-state={v.plan} viewBox={`-2 -2 ${ROOM.lengthM * U + 4} ${ROOM.widthM * U + 4}`} role="img" aria-label={`Planta de irrigação: ${v.label}`}>
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
        </svg>
        <p className="small dim" style={{ margin: 0 }}>
          {v.detail} Sem sensor de vazão, não há confirmação de passagem de água.
        </p>
      </div>
    </section>
  );
}
