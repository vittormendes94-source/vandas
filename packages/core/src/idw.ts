/**
 * Interpolação espacial por IDW (Inverse Distance Weighting, Shepard, potência p = 2).
 *
 *   v(x,y) = Σ wᵢ·vᵢ / Σ wᵢ,   wᵢ = 1 / dᵢ^p
 *
 * Propriedades relevantes para não sugerir precisão que não existe:
 *  - O resultado nunca sai do intervalo [mín, máx] dos sensores (não cria extremos novos).
 *  - Com três pontos, o campo é apenas uma suavização por distância: NÃO modela ventilação,
 *    sombreamento, irrigação nem gradientes reais.
 *  - Fora do casco convexo dos sensores o valor é EXTRAPOLADO (tende ao valor do sensor mais próximo)
 *    e deve ser exibido de forma distinta.
 *  - Com menos de 3 pontos não colineares não há área coberta: não se gera mapa.
 */

export interface ValuePoint {
  x: number;
  y: number;
  v: number;
}

export interface XY {
  x: number;
  y: number;
}

export const IDW_POWER = 2;

export function idwAt(points: ValuePoint[], x: number, y: number, power = IDW_POWER): number | null {
  if (points.length === 0) return null;
  let num = 0;
  let den = 0;
  for (const p of points) {
    const d2 = (p.x - x) ** 2 + (p.y - y) ** 2;
    if (d2 < 1e-12) return p.v;
    const w = 1 / Math.pow(d2, power / 2);
    num += w * p.v;
    den += w;
  }
  return num / den;
}

function cross(o: XY, a: XY, b: XY): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

/** Casco convexo (Andrew, monotone chain), sentido anti-horário, sem repetir o primeiro ponto. */
export function convexHull(points: XY[]): XY[] {
  const pts = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const uniq: XY[] = [];
  for (const p of pts) {
    const last = uniq[uniq.length - 1];
    if (!last || last.x !== p.x || last.y !== p.y) uniq.push(p);
  }
  if (uniq.length <= 2) return uniq;
  const lower: XY[] = [];
  for (const p of uniq) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 1e-12) lower.pop();
    lower.push(p);
  }
  const upper: XY[] = [];
  for (let i = uniq.length - 1; i >= 0; i--) {
    const p = uniq[i]!;
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 1e-12) upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

/** Ponto dentro (ou sobre a borda de) um polígono convexo anti-horário com ≥ 3 vértices. */
export function insideConvexHull(hull: XY[], x: number, y: number, eps = 1e-9): boolean {
  if (hull.length < 3) return false;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i]!;
    const b = hull[(i + 1) % hull.length]!;
    if (cross(a, b, { x, y }) < -eps) return false;
  }
  return true;
}

export type Coverage =
  | { state: 'ok'; hull: XY[] }
  | { state: 'insufficient'; hull: XY[]; validCount: number; reason: string };

/** Precisa de ≥ 3 pontos válidos, não colineares, para delimitar uma área. */
export function assessCoverage(points: XY[]): Coverage {
  const hull = convexHull(points);
  if (hull.length >= 3) return { state: 'ok', hull };
  const n = points.length;
  const reason =
    n === 0
      ? 'Nenhum sensor com leitura atualizada.'
      : n < 3
        ? `Apenas ${n} sensor(es) com leitura atualizada; são necessários 3 para delimitar uma área.`
        : 'Os sensores válidos estão alinhados; não delimitam uma área.';
  return { state: 'insufficient', hull, validCount: n, reason };
}

export interface Field {
  cols: number;
  rows: number;
  /** Valor estimado no centro de cada célula (linha a linha, de cima para baixo). */
  values: Float32Array;
  /** 1 = dentro do casco convexo (interpolado); 0 = fora (extrapolado). */
  inside: Uint8Array;
}

/**
 * Amostra IDW em uma grade regular cobrindo widthM × heightM.
 * Retorna null se a cobertura for insuficiente — nunca preenche um mapa "completo" sem base.
 */
export function buildField(
  points: ValuePoint[],
  widthM: number,
  heightM: number,
  cols: number,
  rows: number,
  power = IDW_POWER,
): Field | null {
  const cov = assessCoverage(points);
  if (cov.state !== 'ok') return null;
  const values = new Float32Array(cols * rows);
  const inside = new Uint8Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    const y = ((r + 0.5) / rows) * heightM;
    for (let c = 0; c < cols; c++) {
      const x = ((c + 0.5) / cols) * widthM;
      const i = r * cols + c;
      values[i] = idwAt(points, x, y, power) ?? NaN;
      inside[i] = insideConvexHull(cov.hull, x, y) ? 1 : 0;
    }
  }
  return { cols, rows, values, inside };
}
