import { describe, expect, it } from 'vitest';
import {
  buildSmoothField,
  colorAt,
  colorBand,
  conditionStops,
  contourLevels,
  contourSegments,
  contourStep,
  defaultConfig,
  fitPlane,
  localDateString,
  openMeteoForecastUrl,
  parseOpenMeteoForecast,
  parseOpenMeteoGeocode,
  parseStoredConfig,
  weatherDayLabel,
  weatherKind,
} from '../src';

const FORECAST = {
  current: { time: '2026-10-26T15:00', interval: 900, temperature_2m: 27.4, relative_humidity_2m: 58, precipitation: 0, weather_code: 2, is_day: 1 },
  daily: {
    time: ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01'],
    weather_code: [2, 61, 80, 95, 3, 0, 1],
    temperature_2m_max: [29.1, 25.3, 24, 26.8, 28, 30.2, 31],
    temperature_2m_min: [17.2, 18, 17.5, 18.1, 16.9, 17, 18.3],
    precipitation_sum: [0, 12.4, 6.1, 22, 0.2, 0, 0],
    precipitation_probability_max: [5, 80, 65, 90, 20, 0, 3],
  },
};

describe('clima (Open-Meteo)', () => {
  it('normaliza a previsão: agora + 7 dias', () => {
    const w = parseOpenMeteoForecast(FORECAST);
    expect(w.current).toEqual({ time: '2026-10-26T15:00', temperatureC: 27.4, humidityPct: 58, precipitationMm: 0, code: 2, isDay: true });
    expect(w.days).toHaveLength(7);
    expect(w.days[3]).toEqual({ date: '2026-10-29', code: 95, tMax: 26.8, tMin: 18.1, rainMm: 22, rainProb: 90 });
  });
  it('resposta sem o essencial é recusada (nada é inventado)', () => {
    expect(() => parseOpenMeteoForecast({ daily: FORECAST.daily })).toThrow();
    expect(() => parseOpenMeteoForecast({ current: FORECAST.current, daily: { ...FORECAST.daily, time: ['26/10'] } })).toThrow();
  });
  it('valores ausentes num dia viram null', () => {
    const w = parseOpenMeteoForecast({ ...FORECAST, daily: { ...FORECAST.daily, precipitation_probability_max: undefined, precipitation_sum: [null, 1, 2, 3, 4, 5, 6] } });
    expect(w.days[0]!.rainMm).toBeNull();
    expect(w.days[0]!.rainProb).toBeNull();
  });
  it('URL pede o fuso de São Paulo e 7 dias', () => {
    const u = new URL(openMeteoForecastUrl(-18.9186, -48.2772));
    expect(u.hostname).toBe('api.open-meteo.com');
    expect(u.searchParams.get('timezone')).toBe('America/Sao_Paulo');
    expect(u.searchParams.get('forecast_days')).toBe('7');
    expect(u.searchParams.get('daily')).toContain('precipitation_probability_max');
  });
  it('busca de cidade', () => {
    const r = parseOpenMeteoGeocode({ results: [{ name: 'Uberlândia', latitude: -18.91, longitude: -48.27, admin1: 'Minas Gerais', country: 'Brasil' }] });
    expect(r[0]).toEqual({ name: 'Uberlândia, Minas Gerais', lat: -18.91, lon: -48.27, label: 'Uberlândia, Minas Gerais, Brasil' });
    expect(parseOpenMeteoGeocode({})).toEqual([]);
  });
  it('códigos WMO e rótulos de dia', () => {
    expect(weatherKind(0).kind).toBe('clear');
    expect(weatherKind(63).kind).toBe('rain');
    expect(weatherKind(81).kind).toBe('showers');
    expect(weatherKind(96).kind).toBe('storm');
    expect(weatherDayLabel('2026-10-26', '2026-10-26')).toBe('Hoje');
    expect(weatherDayLabel('2026-10-27', '2026-10-26')).toBe('Amanhã');
    expect(weatherDayLabel('2026-10-29', '2026-10-26')).toBe('Qui');
    expect(weatherDayLabel('2026-11-01', '2026-10-31')).toBe('Amanhã');
    // 26/10/2026 01:30 em São Paulo ainda é 26/10 (04:30 UTC)
    expect(localDateString(Date.UTC(2026, 9, 26, 4, 30))).toBe('2026-10-26');
    expect(localDateString(Date.UTC(2026, 9, 26, 2, 30))).toBe('2026-10-25');
  });
});

describe('configuração: campos novos', () => {
  it('config salva antes desta versão continua válida e ganha os padrões', () => {
    const old = defaultConfig() as unknown as Record<string, unknown>;
    const { location: _l, ...rest } = old;
    const pump = { deviceId: 'abc', outlet: 1 };
    const c = parseStoredConfig({ ...rest, pump, revision: 7 });
    expect(c.revision).toBe(7);
    expect(c.pump).toEqual({ deviceId: 'abc', outlet: 1, maxRunMin: 5 });
    expect(c.location).toBeNull();
  });
  it('cidade e tempo de irrigação são validados', () => {
    const c = defaultConfig();
    expect(parseStoredConfig({ ...c, location: { name: 'X', lat: 120, lon: 0 } }).revision).toBe(0); // inválido → padrão
    const ok = parseStoredConfig({ ...c, revision: 3, location: { name: 'Uberlândia, MG', lat: -18.9, lon: -48.3 }, pump: { ...c.pump, maxRunMin: 8 } });
    expect(ok.location?.name).toBe('Uberlândia, MG');
    expect(ok.pump.maxRunMin).toBe(8);
  });
});

describe('mapa inteligente', () => {
  const pts = [
    { x: 2, y: 1.2, v: 30 },
    { x: 6, y: 3.8, v: 30.9 },
    { x: 10.5, y: 1.5, v: 31.8 },
  ];
  it('plano passa pelos 3 sensores', () => {
    const p = fitPlane(pts)!;
    for (const q of pts) expect(p.a + p.b * q.x + p.c * q.y).toBeCloseTo(q.v, 6);
    expect(fitPlane([{ x: 0, y: 0, v: 1 }, { x: 1, y: 1, v: 2 }, { x: 2, y: 2, v: 3 }])).toBeNull();
  });
  it('campo nunca sai do intervalo medido e segue a tendência', () => {
    const f = buildSmoothField(pts, 12, 5, 48, 20)!;
    const vals = [...f.values];
    expect(Math.min(...vals)).toBeGreaterThanOrEqual(30 - 1e-6);
    expect(Math.max(...vals)).toBeLessThanOrEqual(31.8 + 1e-6);
    // lado esquerdo mais fresco que o direito
    expect(f.values[10 * 48 + 2]!).toBeLessThan(f.values[10 * 48 + 45]!);
    expect(buildSmoothField(pts.slice(0, 2), 12, 5, 48, 20)).toBeNull();
  });
  it('com 4 sensores passa por todos (correção local)', () => {
    const four = [...pts, { x: 6, y: 0.5, v: 29 }];
    const f = buildSmoothField(four, 12, 5, 120, 50)!;
    // célula mais próxima de (6, 0.5): coluna 59/60, linha 5
    const v = f.values[5 * 120 + 59]!;
    expect(v).toBeCloseTo(29, 0);
  });
  it('faixa de cores: limites do dono; sem limites, referência para Vandas', () => {
    expect(colorBand('temperature', { min: 16, max: 32 })).toEqual({ min: 16, max: 32, fromOwner: true });
    expect(colorBand('humidity', { min: null, max: null })).toEqual({ min: 60, max: 85, fromOwner: false });
    expect(colorBand('temperature', { min: 33, max: null })).toEqual({ min: 33, max: 45, fromOwner: true });
  });
  it('cores: verde no meio da faixa, quente acima, frio abaixo', () => {
    const stops = conditionStops('temperature', { min: 18, max: 30 });
    const [r1, g1] = colorAt(stops, 23);
    expect(g1).toBeGreaterThan(r1); // verde
    const [r2, , b2] = colorAt(stops, 34);
    expect(r2).toBeGreaterThan(200);
    expect(b2).toBeLessThan(100); // vermelho
    const [r3, , b3] = colorAt(stops, 12);
    expect(b3).toBeGreaterThan(r3); // azul
  });
  it('isolinhas', () => {
    expect(contourStep('temperature', 30, 31.8)).toBe(0.5);
    expect(contourStep('humidity', 54, 60)).toBe(2);
    expect(contourLevels(30, 31.8, 0.5)).toEqual([30.5, 31, 31.5]);
    const v = new Float32Array([0, 1, 0, 1]); // 2×2: esquerda 0, direita 1
    expect(contourSegments(v, 2, 2, 0.5)).toEqual([[0.5, 0, 0.5, 1]]);
  });
});

describe('projeção com poucos sensores', () => {
  it('1 sensor: estufa toda com o valor dele', async () => {
    const { buildProjection } = await import('../src');
    const f = buildProjection([{ x: 6, y: 2.5, v: 28 }], 12, 5, 12, 5)!;
    expect([...f.values].every((v) => Math.abs(v - 28) < 1e-6)).toBe(true);
    expect(buildProjection([], 12, 5, 12, 5)).toBeNull();
  });
  it('2 sensores: varia ao longo da linha entre eles, dentro do intervalo medido', async () => {
    const { buildProjection } = await import('../src');
    const f = buildProjection([{ x: 2, y: 2.5, v: 26 }, { x: 10, y: 2.5, v: 30 }], 12, 5, 12, 5)!;
    expect(f.values[2 * 12 + 0]).toBeCloseTo(26, 6); // antes do primeiro: valor dele
    expect(f.values[2 * 12 + 5]).toBeCloseTo(26 + (4 * (5.5 - 2)) / 8, 5);
    expect(f.values[2 * 12 + 11]).toBeCloseTo(30, 6);
    expect(f.values[0]).toBeCloseTo(f.values[4 * 12]!, 6); // constante na perpendicular
  });
});
