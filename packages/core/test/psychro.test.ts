import { describe, expect, it } from 'vitest';
import { dewPointC, saturationVaporPressureKpa, vpdKpa } from '../src/psychro';

describe('pressão de saturação (Magnus)', () => {
  // Valores de referência (tabelas sobre água líquida): 20 °C = 2,339 kPa; 25 °C = 3,169 kPa; 30 °C = 4,246 kPa.
  it.each([
    [20, 2.339],
    [25, 3.169],
    [30, 4.246],
  ])('es(%d °C) ≈ %d kPa (erro < 0,5 %)', (t, ref) => {
    expect(Math.abs(saturationVaporPressureKpa(t) - ref) / ref).toBeLessThan(0.005);
  });
});

describe('DPV do ar', () => {
  it('25 °C / 50 % UR ≈ 1,58 kPa', () => {
    expect(vpdKpa(25, 50)).toBeCloseTo(1.58, 1);
  });
  it('é zero com ar saturado', () => {
    expect(vpdKpa(25, 100)).toBeCloseTo(0, 10);
  });
  it('cresce quando a UR cai na mesma temperatura', () => {
    expect(vpdKpa(28, 40)!).toBeGreaterThan(vpdKpa(28, 70)!);
  });
  it('rejeita entradas inválidas', () => {
    expect(vpdKpa(25, 101)).toBeNull();
    expect(vpdKpa(25, -1)).toBeNull();
    expect(vpdKpa(NaN, 50)).toBeNull();
    expect(vpdKpa(200, 50)).toBeNull();
  });
});

describe('ponto de orvalho', () => {
  it('25 °C / 50 % UR ≈ 13,9 °C', () => {
    expect(dewPointC(25, 50)).toBeCloseTo(13.86, 1);
  });
  it('31 °C / 54 % UR ≈ 20,6 °C', () => {
    expect(dewPointC(31, 54)).toBeCloseTo(20.6, 1);
  });
  it('com 100 % UR é igual à temperatura do ar', () => {
    expect(dewPointC(22, 100)).toBeCloseTo(22, 6);
  });
  it('nunca excede a temperatura do ar', () => {
    for (const rh of [5, 30, 60, 95]) expect(dewPointC(27, rh)!).toBeLessThanOrEqual(27);
  });
  it('é indefinido com UR = 0', () => {
    expect(dewPointC(25, 0)).toBeNull();
  });
});
