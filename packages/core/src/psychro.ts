/**
 * Psicrometria do ar: pressão de saturação, DPV e ponto de orvalho.
 *
 * Fórmula de Magnus (constantes de Alduchov & Eskridge, 1996), válida aprox. de −40 a 50 °C sobre água:
 *
 *   es(T)  = 0,61094 · exp(17,625·T / (T + 243,04))            [kPa, T em °C]
 *   ea     = es(T) · UR/100
 *   DPV    = es(T) − ea = es(T) · (1 − UR/100)                 [kPa]
 *   γ      = ln(UR/100) + 17,625·T / (243,04 + T)
 *   Td     = 243,04·γ / (17,625 − γ)                            [°C]
 *
 * "DPV do ar" usa a temperatura do AR (sensor). Não é o DPV da folha: a temperatura foliar não é medida
 * e costuma diferir da do ar. O erro da aproximação de Magnus frente a tabelas de referência é ≈ 0,3 %.
 */

const A = 17.625;
const B = 243.04;
const E0_KPA = 0.61094;

export function isValidTemperatureC(t: number): boolean {
  return Number.isFinite(t) && t >= -40 && t <= 85;
}

export function isValidHumidityPct(rh: number): boolean {
  return Number.isFinite(rh) && rh >= 0 && rh <= 100;
}

/** Pressão de saturação do vapor (kPa) à temperatura T (°C). */
export function saturationVaporPressureKpa(tC: number): number {
  return E0_KPA * Math.exp((A * tC) / (tC + B));
}

/** Déficit de pressão de vapor do ar (kPa). Retorna null para entradas inválidas. */
export function vpdKpa(tC: number, rhPct: number): number | null {
  if (!isValidTemperatureC(tC) || !isValidHumidityPct(rhPct)) return null;
  return saturationVaporPressureKpa(tC) * (1 - rhPct / 100);
}

/** Ponto de orvalho (°C). Retorna null se UR ≤ 0 (indefinido) ou entradas inválidas. */
export function dewPointC(tC: number, rhPct: number): number | null {
  if (!isValidTemperatureC(tC) || !isValidHumidityPct(rhPct) || rhPct <= 0) return null;
  const gamma = Math.log(rhPct / 100) + (A * tC) / (B + tC);
  return (B * gamma) / (A - gamma);
}

export interface Psychro {
  dpvKpa: number | null;
  dewPointC: number | null;
}

/** Calcula por sensor, antes de qualquer resumo. */
export function psychroFor(tC: number, rhPct: number): Psychro {
  return { dpvKpa: vpdKpa(tC, rhPct), dewPointC: dewPointC(tC, rhPct) };
}
