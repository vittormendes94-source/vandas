import { useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import { ROOM } from '@orq/core';

const U = 10;

export interface EditItem {
  id: string;
  label: string;
  xM: number;
  yM: number;
  radiusM?: number;
}

interface Props {
  items: EditItem[];
  onMove: (id: string, xM: number, yM: number) => void;
  kind: 'sensor' | 'sprinkler';
  ariaLabel: string;
  /** Itens de referência (não arrastáveis) desenhados ao fundo. */
  ghosts?: EditItem[];
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const snap = (v: number) => Math.round(v * 20) / 20; // 0,05 m

/** Editor de posições arrastável (mouse/toque) e acessível por teclado (setas movem 0,1 m). Limites 12 × 5 m. */
export function PlanEditor({ items, onMove, kind, ariaLabel, ghosts }: Props) {
  const ref = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<string | null>(null);

  const toMeters = (e: ReactPointerEvent) => {
    const svg = ref.current!;
    const r = svg.getBoundingClientRect();
    const vbW = ROOM.lengthM * U + 4;
    const vbH = ROOM.widthM * U + 4;
    const x = ((e.clientX - r.left) / r.width) * vbW - 2;
    const y = ((e.clientY - r.top) / r.height) * vbH - 2;
    return { x: snap(clamp(x / U, 0, ROOM.lengthM)), y: snap(clamp(y / U, 0, ROOM.widthM)) };
  };

  const onKey = (e: KeyboardEvent, it: EditItem) => {
    const d = { ArrowLeft: [-0.1, 0], ArrowRight: [0.1, 0], ArrowUp: [0, -0.1], ArrowDown: [0, 0.1] }[e.key];
    if (!d) return;
    e.preventDefault();
    onMove(it.id, snap(clamp(it.xM + d[0]!, 0, ROOM.lengthM)), snap(clamp(it.yM + d[1]!, 0, ROOM.widthM)));
  };

  return (
    <svg
      ref={ref}
      className="editor"
      viewBox={`-2 -2 ${ROOM.lengthM * U + 4} ${ROOM.widthM * U + 4}`}
      role="group"
      aria-label={ariaLabel}
      onPointerMove={(e) => {
        if (!drag) return;
        const p = toMeters(e);
        onMove(drag, p.x, p.y);
      }}
      onPointerUp={() => setDrag(null)}
      onPointerCancel={() => setDrag(null)}
    >
      <rect x={0} y={0} width={ROOM.lengthM * U} height={ROOM.widthM * U} fill="none" stroke="#2a4250" strokeWidth={0.4} />
      {Array.from({ length: ROOM.lengthM - 1 }, (_, i) => (
        <line key={`x${i}`} x1={(i + 1) * U} x2={(i + 1) * U} y1={0} y2={ROOM.widthM * U} stroke="rgba(255,255,255,0.06)" strokeWidth={0.2} />
      ))}
      {Array.from({ length: ROOM.widthM - 1 }, (_, i) => (
        <line key={`y${i}`} y1={(i + 1) * U} y2={(i + 1) * U} x1={0} x2={ROOM.lengthM * U} stroke="rgba(255,255,255,0.06)" strokeWidth={0.2} />
      ))}
      {ghosts?.map((g) => (
        <g key={`g${g.id}`} opacity={0.35}>
          <circle cx={g.xM * U} cy={g.yM * U} r={1.4} fill="none" stroke="#38d6e8" strokeWidth={0.3} />
        </g>
      ))}
      {items.map((it) => (
        <g
          key={it.id}
          className="item"
          tabIndex={0}
          role="button"
          aria-label={`${it.label}: x ${it.xM.toFixed(2)} m, y ${it.yM.toFixed(2)} m. Arraste ou use as setas.`}
          onPointerDown={(e) => {
            (e.currentTarget as SVGGElement).setPointerCapture?.(e.pointerId);
            ref.current?.setPointerCapture?.(e.pointerId);
            setDrag(it.id);
          }}
          onKeyDown={(e) => onKey(e, it)}
        >
          {it.radiusM !== undefined && <circle cx={it.xM * U} cy={it.yM * U} r={it.radiusM * U} fill="rgba(56,214,232,0.05)" stroke="rgba(56,214,232,0.3)" strokeWidth={0.2} strokeDasharray="0.6 0.6" pointerEvents="none" />}
          {kind === 'sensor' ? (
            <rect x={it.xM * U - 3.2} y={it.yM * U - 2} width={6.4} height={4} rx={1} fill="#0b171d" stroke="#3ddc97" strokeWidth={0.5} />
          ) : (
            <circle cx={it.xM * U} cy={it.yM * U} r={2} fill="#0b171d" stroke="#38d6e8" strokeWidth={0.5} />
          )}
          <text x={it.xM * U} y={it.yM * U + (kind === 'sensor' ? 0.9 : 0.8)} textAnchor="middle" fontSize={kind === 'sensor' ? 2.3 : 1.9} fill="#e8f2f3" fontWeight={700} pointerEvents="none">
            {it.label}
          </text>
        </g>
      ))}
    </svg>
  );
}
