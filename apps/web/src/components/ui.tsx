import type { ReactNode } from 'react';
import type { Dataset, Freshness } from '@orq/core';

export type ChipKind = 'sim' | 'measured' | 'calc' | 'est' | 'warn' | 'bad' | 'ok' | 'plain';

export function Chip({ kind = 'plain', children, title }: { kind?: ChipKind; children: ReactNode; title?: string }) {
  return (
    <span className={`chip chip--${kind}`} title={title}>
      {children}
    </span>
  );
}

/** Origem do dado: no conjunto de demonstração tudo é SIMULADO; no real, as leituras são MEDIDAS (recebidas). */
export function OriginChip({ dataset }: { dataset: Dataset }) {
  return dataset === 'demo' ? (
    <Chip kind="sim" title="Valor gerado por simulação; não vem de nenhum sensor.">
      Simulado
    </Chip>
  ) : (
    <Chip kind="measured" title="Medição recebida de um sensor.">
      Medido
    </Chip>
  );
}

export const CalcChip = () => (
  <Chip kind="calc" title="Indicador calculado a partir das leituras dos sensores.">
    Calculado
  </Chip>
);
export const EstChip = () => (
  <Chip kind="est" title="Valor espacial estimado por interpolação entre sensores; não é medição.">
    Estimado
  </Chip>
);

const FRESH_LABEL: Record<Freshness, { text: string; kind: ChipKind }> = {
  fresh: { text: 'Atualizado', kind: 'ok' },
  delayed: { text: 'Atrasado', kind: 'warn' },
  unavailable: { text: 'Sem comunicação', kind: 'bad' },
};

export function FreshnessChip({ freshness, replay }: { freshness: Freshness; replay?: boolean }) {
  if (replay) {
    return freshness === 'fresh' ? <Chip kind="ok">Com leitura no instante</Chip> : <Chip kind="bad">Sem leitura no instante</Chip>;
  }
  const f = FRESH_LABEL[freshness];
  return <Chip kind={f.kind}>{f.text}</Chip>;
}

export function Notice({ kind, children }: { kind?: 'warn' | 'bad' | 'sim'; children: ReactNode }) {
  return <div className={`notice${kind ? ` notice--${kind}` : ''}`}>{children}</div>;
}

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 64 64" aria-hidden="true">
      <rect width="64" height="64" rx="14" fill="#0d161c" stroke="#1e2f39" />
      <g fill="none" stroke="#3ddc97" strokeWidth="4" strokeLinecap="round">
        <path d="M32 52V30" />
        <path d="M32 30c-10-2-16-9-16-17 9 1 15 7 16 17z" stroke="#38d6e8" />
        <path d="M32 30c10-2 16-9 16-17-9 1-15 7-16 17z" />
      </g>
    </svg>
  );
}
