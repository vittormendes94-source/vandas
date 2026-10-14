import type { Quantity } from '@orq/core';

type RGB = [number, number, number];
const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

/** Rampas de cor. Servem só para comparar valores dentro da escala fixa; NÃO indicam faixa ideal ou perigosa. */
export const RAMPS: Record<Quantity, { pos: number; color: string }[]> = {
  temperature: [
    { pos: 0, color: '#2b6cb0' },
    { pos: 0.25, color: '#2bb3c0' },
    { pos: 0.5, color: '#6fd08c' },
    { pos: 0.72, color: '#f2d15c' },
    { pos: 0.88, color: '#f28c38' },
    { pos: 1, color: '#e5484d' },
  ],
  humidity: [
    { pos: 0, color: '#e9c46a' },
    { pos: 0.3, color: '#8fd3a8' },
    { pos: 0.6, color: '#2fb5c9' },
    { pos: 0.8, color: '#2f7fd0' },
    { pos: 1, color: '#4a4fc4' },
  ],
};

export function rampColor(q: Quantity, t: number): RGB {
  const stops = RAMPS[q];
  const x = Math.min(1, Math.max(0, t));
  for (let i = 1; i < stops.length; i++) {
    const a = stops[i - 1]!;
    const b = stops[i]!;
    if (x <= b.pos) {
      const f = (x - a.pos) / (b.pos - a.pos || 1);
      const ca = hex(a.color);
      const cb = hex(b.color);
      return [ca[0] + (cb[0] - ca[0]) * f, ca[1] + (cb[1] - ca[1]) * f, ca[2] + (cb[2] - ca[2]) * f];
    }
  }
  return hex(stops[stops.length - 1]!.color);
}

export function rampGradientCss(q: Quantity): string {
  return `linear-gradient(90deg, ${RAMPS[q].map((s) => `${s.color} ${Math.round(s.pos * 100)}%`).join(', ')})`;
}

/** Cores das séries por sensor (distintas entre si e legíveis no fundo escuro). */
export const SERIES_COLORS = ['#38d6e8', '#3ddc97', '#c4a7ff', '#ff8fb1', '#ffd166', '#8ecae6', '#b5e48c', '#f4a261'];
