/**
 * Mapa "inteligente" da Visão TV.
 *
 * Campo: tendência linear (plano ajustado por mínimos quadrados) + correção local por IDW dos resíduos.
 *  - Com 3 sensores o plano passa exatamente pelos 3 valores: o mapa mostra a direção em que a estufa esquenta
 *    ou umedece, sem os "alvos" circulares do IDW puro.
 *  - Com mais sensores, o IDW dos resíduos faz o campo passar por cada sensor.
 *  - O valor é limitado ao intervalo [mín, máx] dos sensores: nunca inventa um extremo que ninguém mediu.
 *
 * Cores: pela FAIXA IDEAL (limites do dono, ou referência para Vandas quando não informados). Verde = dentro da
 * faixa; amarelo/laranja/vermelho = indo para o quente; azul = frio. Na umidade: amarelo/laranja/marrom = seco,
 * azul/anil = saturado.
 */
import { assessCoverage, idwAt, insideConvexHull } from './idw';
import type { Field, ValuePoint } from './idw';
import type { Limits, Quantity } from './types';

export type RGB = [number, number, number];

interface Plane {
  a: number;
  b: number;
  c: number;
}

/** Plano v = a + b·x + c·y por mínimos quadrados. null se os pontos forem colineares (ou < 3). */
export function fitPlane(points: ValuePoint[]): Plane | null {
  if (points.length < 3) return null;
  let n = 0, sx = 0, sy = 0, sv = 0, sxx = 0, syy = 0, sxy = 0, sxv = 0, syv = 0;
  for (const p of points) {
    n += 1;
    sx += p.x;
    sy += p.y;
    sv += p.v;
    sxx += p.x * p.x;
    syy += p.y * p.y;
    sxy += p.x * p.y;
    sxv += p.x * p.v;
    syv += p.y * p.v;
  }
  // Sistema normal 3×3 resolvido por Cramer.
  const m = [
    [n, sx, sy],
    [sx, sxx, sxy],
    [sy, sxy, syy],
  ] as const;
  const r = [sv, sxv, syv] as const;
  const det3 = (q: readonly (readonly number[])[]) =>
    q[0]![0]! * (q[1]![1]! * q[2]![2]! - q[1]![2]! * q[2]![1]!) -
    q[0]![1]! * (q[1]![0]! * q[2]![2]! - q[1]![2]! * q[2]![0]!) +
    q[0]![2]! * (q[1]![0]! * q[2]![1]! - q[1]![1]! * q[2]![0]!);
  const D = det3(m);
  const scale = Math.max(1, Math.abs(sxx * syy));
  if (Math.abs(D) < 1e-9 * scale) return null;
  const col = (k: number) => m.map((row, i) => row.map((v, j) => (j === k ? r[i]! : v)));
  return { a: det3(col(0)) / D, b: det3(col(1)) / D, c: det3(col(2)) / D };
}

const planeAt = (p: Plane, x: number, y: number) => p.a + p.b * x + p.c * y;

/** Campo suave numa grade cols × rows sobre widthM × heightM. null sem cobertura (≥ 3 sensores não alinhados). */
export function buildSmoothField(points: ValuePoint[], widthM: number, heightM: number, cols: number, rows: number): Field | null {
  const cov = assessCoverage(points);
  if (cov.state !== 'ok') return null;
  const plane = fitPlane(points);
  if (!plane) return null;
  const residuals = points.map((p) => ({ x: p.x, y: p.y, v: p.v - planeAt(plane, p.x, p.y) }));
  const hasResidual = residuals.some((r) => Math.abs(r.v) > 1e-9);
  const lo = Math.min(...points.map((p) => p.v));
  const hi = Math.max(...points.map((p) => p.v));
  const values = new Float32Array(cols * rows);
  const inside = new Uint8Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    const y = ((r + 0.5) / rows) * heightM;
    for (let c = 0; c < cols; c++) {
      const x = ((c + 0.5) / cols) * widthM;
      const i = r * cols + c;
      const v = planeAt(plane, x, y) + (hasResidual ? (idwAt(residuals, x, y) ?? 0) : 0);
      values[i] = Math.min(hi, Math.max(lo, v));
      inside[i] = insideConvexHull(cov.hull, x, y) ? 1 : 0;
    }
  }
  return { cols, rows, values, inside };
}

/** Referência quando o dono não informou limites (Vandas em estufa). Só orienta as cores; não gera alertas. */
export const REFERENCE_BAND: Record<Quantity, { min: number; max: number }> = {
  temperature: { min: 18, max: 30 },
  humidity: { min: 60, max: 85 },
};

/** Faixa usada nas cores: limites do dono quando existem; o que faltar vem da referência. */
export function colorBand(q: Quantity, limits: Limits): { min: number; max: number; fromOwner: boolean } {
  const ref = REFERENCE_BAND[q];
  let min = limits.min ?? ref.min;
  let max = limits.max ?? ref.max;
  if (min >= max) {
    // Um só limite informado e incompatível com a referência: abre uma faixa a partir dele.
    if (limits.min !== null) max = min + (ref.max - ref.min);
    else min = max - (ref.max - ref.min);
  }
  return { min, max, fromOwner: limits.min !== null || limits.max !== null };
}

export interface ColorStop {
  v: number;
  rgb: RGB;
}

const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

/** Paradas de cor em valores absolutos, ancoradas na faixa ideal. */
export function conditionStops(q: Quantity, band: { min: number; max: number }): ColorStop[] {
  const { min: lo, max: hi } = band;
  const w = hi - lo;
  const s: [number, string][] =
    q === 'temperature'
      ? [
          [lo - 6, '#3b4cc0'],
          [lo - 2, '#4f8fe6'],
          [lo, '#36c2c9'],
          [lo + 0.35 * w, '#45d483'],
          [lo + 0.65 * w, '#a8dc4f'],
          [hi - 0.1 * w, '#f4cf3f'],
          [hi, '#ff9a3c'],
          [hi + 3, '#f0533e'],
          [hi + 7, '#b8203a'],
        ]
      : [
          [lo - 25, '#9c5a1f'],
          [lo - 10, '#e0912f'],
          [lo, '#f2c94c'],
          [lo + 0.3 * w, '#7fd68a'],
          [lo + 0.7 * w, '#34c3b0'],
          [hi, '#3b9be0'],
          [hi + 8, '#4b5fd1'],
        ];
  return s.map(([v, c]) => ({ v, rgb: hex(c) }));
}

export function colorAt(stops: ColorStop[], v: number): RGB {
  if (v <= stops[0]!.v) return stops[0]!.rgb;
  for (let i = 1; i < stops.length; i++) {
    const a = stops[i - 1]!;
    const b = stops[i]!;
    if (v <= b.v) {
      const f = (v - a.v) / (b.v - a.v || 1);
      return [a.rgb[0] + (b.rgb[0] - a.rgb[0]) * f, a.rgb[1] + (b.rgb[1] - a.rgb[1]) * f, a.rgb[2] + (b.rgb[2] - a.rgb[2]) * f];
    }
  }
  return stops[stops.length - 1]!.rgb;
}

/** Passo das isolinhas: o menor "redondo" que gera no máximo 4 linhas no intervalo medido. */
export function contourStep(q: Quantity, lo: number, hi: number): number {
  const steps = q === 'temperature' ? [0.2, 0.5, 1, 2, 5] : [1, 2, 5, 10, 20];
  const range = hi - lo;
  for (const s of steps) if (range / s <= 4) return s;
  return steps[steps.length - 1]!;
}

export function contourLevels(lo: number, hi: number, step: number): number[] {
  const out: number[] = [];
  for (let v = Math.ceil(lo / step + 1e-9) * step; v < hi - 1e-9; v += step) out.push(Math.round(v * 1000) / 1000);
  return out;
}

/**
 * Isolinha por "marching squares" sobre os centros das células. Segmentos em coordenadas de grade
 * (0..cols-1, 0..rows-1), prontos para converter em pixels: x_px = (gx + 0.5) / cols × largura.
 */
export function contourSegments(values: Float32Array, cols: number, rows: number, level: number): [number, number, number, number][] {
  const segs: [number, number, number, number][] = [];
  const at = (c: number, r: number) => values[r * cols + c]!;
  const lerp = (a: number, b: number) => (a === b ? 0.5 : (level - a) / (b - a));
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const tl = at(c, r);
      const tr = at(c + 1, r);
      const br = at(c + 1, r + 1);
      const bl = at(c, r + 1);
      const idx = (tl >= level ? 8 : 0) | (tr >= level ? 4 : 0) | (br >= level ? 2 : 0) | (bl >= level ? 1 : 0);
      if (idx === 0 || idx === 15) continue;
      const top: [number, number] = [c + lerp(tl, tr), r];
      const right: [number, number] = [c + 1, r + lerp(tr, br)];
      const bottom: [number, number] = [c + lerp(bl, br), r + 1];
      const left: [number, number] = [c, r + lerp(tl, bl)];
      const add = (p: [number, number], q: [number, number]) => segs.push([p[0], p[1], q[0], q[1]]);
      const center = (tl + tr + br + bl) / 4 >= level;
      switch (idx) {
        case 1: case 14: add(left, bottom); break;
        case 2: case 13: add(bottom, right); break;
        case 3: case 12: add(left, right); break;
        case 4: case 11: add(top, right); break;
        case 6: case 9: add(top, bottom); break;
        case 7: case 8: add(left, top); break;
        case 5:
          if (center) { add(left, top); add(bottom, right); } else { add(left, bottom); add(top, right); }
          break;
        case 10:
          if (center) { add(left, bottom); add(top, right); } else { add(left, top); add(bottom, right); }
          break;
      }
    }
  }
  return segs;
}

/**
 * Projeção para a estufa inteira com o que houver de sensores:
 *  - 3 ou mais (não alinhados): tendência + correção local (buildSmoothField);
 *  - 2, ou vários alinhados: variação ao longo da linha que os une (constante na direção perpendicular);
 *  - 1: a estufa toda com o valor dele.
 * Sempre dentro do intervalo medido. `inside` marca a área entre os sensores (≥ 3), onde a estimativa é mais firme.
 */
export function buildProjection(points: ValuePoint[], widthM: number, heightM: number, cols: number, rows: number): Field | null {
  if (points.length === 0) return null;
  const smooth = points.length >= 3 ? buildSmoothField(points, widthM, heightM, cols, rows) : null;
  if (smooth) return smooth;
  const values = new Float32Array(cols * rows);
  const inside = new Uint8Array(cols * rows);
  // Eixo entre o par de sensores mais distantes.
  let a = points[0]!;
  let b = points[0]!;
  let best = -1;
  for (const p of points)
    for (const q of points) {
      const d = (p.x - q.x) ** 2 + (p.y - q.y) ** 2;
      if (d > best) {
        best = d;
        a = p;
        b = q;
      }
    }
  const len2 = best;
  const along = (x: number, y: number) => (len2 > 1e-12 ? ((x - a.x) * (b.x - a.x) + (y - a.y) * (b.y - a.y)) / len2 : 0);
  const sorted = points.map((p) => ({ t: along(p.x, p.y), v: p.v })).sort((p, q) => p.t - q.t);
  const valueAt = (t: number) => {
    if (t <= sorted[0]!.t) return sorted[0]!.v;
    for (let i = 1; i < sorted.length; i++) {
      const p = sorted[i - 1]!;
      const q = sorted[i]!;
      if (t <= q.t) return q.t - p.t < 1e-12 ? q.v : p.v + ((q.v - p.v) * (t - p.t)) / (q.t - p.t);
    }
    return sorted[sorted.length - 1]!.v;
  };
  for (let r = 0; r < rows; r++) {
    const y = ((r + 0.5) / rows) * heightM;
    for (let c = 0; c < cols; c++) values[r * cols + c] = valueAt(along(((c + 0.5) / cols) * widthM, y));
  }
  return { cols, rows, values, inside };
}
