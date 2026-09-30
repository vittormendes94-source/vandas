import { describe, expect, it } from 'vitest';
import { assessCoverage, buildField, convexHull, idwAt, insideConvexHull } from '../src/idw';

const pts = [
  { x: 2, y: 1, v: 31 },
  { x: 6, y: 4, v: 28 },
  { x: 10, y: 1.5, v: 26 },
];

describe('IDW', () => {
  it('devolve exatamente o valor medido sobre o sensor', () => {
    expect(idwAt(pts, 2, 1)).toBe(31);
    expect(idwAt(pts, 10, 1.5)).toBe(26);
  });
  it('nunca sai do intervalo dos sensores', () => {
    for (let x = 0; x <= 12; x += 0.7) for (let y = 0; y <= 5; y += 0.5) {
      const v = idwAt(pts, x, y)!;
      expect(v).toBeGreaterThanOrEqual(26 - 1e-9);
      expect(v).toBeLessThanOrEqual(31 + 1e-9);
    }
  });
  it('é simétrico: ponto equidistante de dois sensores iguais dá a média', () => {
    const two = [
      { x: 0, y: 0, v: 10 },
      { x: 2, y: 0, v: 20 },
    ];
    expect(idwAt(two, 1, 0)).toBeCloseTo(15, 10);
  });
  it('sem pontos, não inventa valor', () => {
    expect(idwAt([], 1, 1)).toBeNull();
  });
});

describe('casco convexo e cobertura', () => {
  it('três pontos não colineares formam um triângulo', () => {
    expect(convexHull(pts)).toHaveLength(3);
    expect(assessCoverage(pts).state).toBe('ok');
  });
  it('distingue dentro de fora', () => {
    const hull = convexHull(pts);
    expect(insideConvexHull(hull, 6, 2.5)).toBe(true);
    expect(insideConvexHull(hull, 0.5, 4.5)).toBe(false);
    expect(insideConvexHull(hull, 11.5, 4.5)).toBe(false);
  });
  it('dois pontos ou pontos colineares = cobertura insuficiente', () => {
    expect(assessCoverage(pts.slice(0, 2)).state).toBe('insufficient');
    expect(assessCoverage([{ x: 1, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 3 }]).state).toBe('insufficient');
    expect(assessCoverage([]).state).toBe('insufficient');
  });
  it('buildField devolve null quando a cobertura é insuficiente', () => {
    expect(buildField(pts.slice(0, 2), 12, 5, 24, 10)).toBeNull();
  });
  it('buildField marca células extrapoladas', () => {
    const f = buildField(pts, 12, 5, 48, 20)!;
    expect(f.values).toHaveLength(48 * 20);
    const inside = f.inside.reduce((a, b) => a + b, 0);
    expect(inside).toBeGreaterThan(0);
    expect(inside).toBeLessThan(48 * 20);
    // canto superior esquerdo (0,0) está fora do triângulo
    expect(f.inside[0]).toBe(0);
  });
});
