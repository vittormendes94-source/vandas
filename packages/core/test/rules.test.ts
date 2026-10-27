import { describe, expect, it } from 'vitest';
import { DEFAULT_IRRIGATION_RULES, IrrigationRulesSchema, defaultConfig, inWindow, irrigationAdvice, localDateTimeString, parseOpenMeteoForecast, parseStoredConfig } from '../src';
import type { WeatherHour } from '../src';

const rules = DEFAULT_IRRIGATION_RULES; // 30 °C, 500 W/m²
const hours = (base: string, sun: number[]): WeatherHour[] =>
  sun.map((s, i) => ({ time: `${base}T${String(i).padStart(2, '0')}:00`, temperatureC: 25, directRadiationWm2: s, rainProb: 0 }));
// sol de um dia limpo: 0 à noite, pico ~800 ao meio-dia
const SUN = [0, 0, 0, 0, 0, 0, 20, 120, 300, 480, 650, 780, 820, 800, 700, 560, 380, 180, 30, 0, 0, 0, 0, 0];

describe('regras de irrigação', () => {
  it('estufa fresca e sol fraco: pode irrigar', () => {
    const a = irrigationAdvice({ rules, insideMaxC: 26.4, sunWm2: 120, nowLocal: '2026-10-26T07:30' });
    expect(a).toEqual({ state: 'ok', reasons: [], missing: [], nextGood: null });
  });
  it('estufa quente: não irrigar, sem previsão (temperatura da estufa não tem previsão)', () => {
    const a = irrigationAdvice({ rules, insideMaxC: 31.2, sunWm2: 100, nowLocal: '2026-10-26T17:30', hours: hours('2026-10-26', SUN) });
    expect(a.state).toBe('no');
    expect(a.reasons).toEqual(['Estufa a 31,2° (limite 30°)']);
    expect(a.nextGood).toBeNull();
  });
  it('sol forte: não irrigar e indica o próximo horário em que o sol baixa', () => {
    const a = irrigationAdvice({ rules, insideMaxC: 28, sunWm2: 780, nowLocal: '2026-10-26T11:20', hours: hours('2026-10-26', SUN) });
    expect(a.state).toBe('no');
    expect(a.reasons).toEqual(['Sol forte: 780 W/m² (limite 500)']);
    // 15:00 tem 560 (acima); 16:00 tem 380 e a hora seguinte 180 → primeira hora boa: 16:00
    expect(a.nextGood).toBe('16:00');
  });
  it('período a evitar (inclusive atravessando a meia-noite)', () => {
    expect(inWindow('12:00', '10:00', '16:00')).toBe(true);
    expect(inWindow('16:00', '10:00', '16:00')).toBe(false);
    expect(inWindow('23:30', '22:00', '05:00')).toBe(true);
    expect(inWindow('06:00', '22:00', '05:00')).toBe(false);
    const a = irrigationAdvice({ rules: { maxTempC: null, maxSunWm2: null, avoidFrom: '10:00', avoidTo: '16:00' }, insideMaxC: null, sunWm2: null, nowLocal: '2026-10-26T12:00', hours: hours('2026-10-26', SUN) });
    expect(a.reasons).toEqual(['Horário a evitar (10:00–16:00)']);
    expect(a.nextGood).toBe('16:00');
  });
  it('próximo horário pode ser amanhã', () => {
    const h = [...hours('2026-10-26', SUN.map(() => 900)), ...hours('2026-10-27', SUN)];
    const a = irrigationAdvice({ rules, insideMaxC: 25, sunWm2: 900, nowLocal: '2026-10-26T20:00', hours: h });
    expect(a.nextGood).toBe('amanhã 00:00');
  });
  it('sem dados: não diz que pode irrigar', () => {
    const a = irrigationAdvice({ rules, insideMaxC: null, sunWm2: null, nowLocal: '2026-10-26T08:00' });
    expect(a.state).toBe('unknown');
    expect(a.missing).toEqual(['sem leitura atual da estufa', 'sem dado de sol']);
  });
  it('validação e compatibilidade da configuração', () => {
    expect(IrrigationRulesSchema.safeParse({ ...rules, avoidFrom: '10:00', avoidTo: null }).success).toBe(false);
    expect(IrrigationRulesSchema.safeParse({ ...rules, avoidFrom: '25:00', avoidTo: '10:00' }).success).toBe(false);
    const { irrigationRules: _r, ...old } = defaultConfig();
    expect(parseStoredConfig({ ...old, revision: 4 }).irrigationRules).toEqual(DEFAULT_IRRIGATION_RULES);
    expect(parseStoredConfig({ ...old, revision: 4 }).revision).toBe(4);
  });
  it('horário local e previsão hora a hora do Open-Meteo', () => {
    expect(localDateTimeString(Date.UTC(2026, 9, 26, 14, 5))).toBe('2026-10-26T11:05');
    expect(localDateTimeString(Date.UTC(2026, 9, 27, 2, 59))).toBe('2026-10-26T23:59');
    const w = parseOpenMeteoForecast({
      current: { time: '2026-10-26T11:00', temperature_2m: 29, relative_humidity_2m: 50, weather_code: 0, is_day: 1, direct_radiation: 712 },
      daily: { time: ['2026-10-26'], weather_code: [0], temperature_2m_max: [31], temperature_2m_min: [18], precipitation_sum: [0] },
      hourly: { time: ['2026-10-26T00:00', '2026-10-26T01:00'], temperature_2m: [19, 18.5], direct_radiation: [0, 0], precipitation_probability: [0, 5] },
    });
    expect(w.current.directRadiationWm2).toBe(712);
    expect(w.hours).toEqual([
      { time: '2026-10-26T00:00', temperatureC: 19, directRadiationWm2: 0, rainProb: 0 },
      { time: '2026-10-26T01:00', temperatureC: 18.5, directRadiationWm2: 0, rainProb: 5 },
    ]);
  });
});

describe('o que fazer (insights da semana)', () => {
  it('aponta ar seco no meio do dia, noites frias e o ponto diferente', async () => {
    const { weeklyInsights, defaultConfig } = await import('../src');
    const c = { ...defaultConfig(), alerts: { temperature: { min: 24, max: 30 }, humidity: { min: 70, max: 80 }, dpv: { min: null, max: null } }, nightTemperature: { from: '18:00', to: '06:00', limits: { min: 18, max: 22 } } };
    const b = [];
    const base = Date.UTC(2026, 9, 20, 3); // 00:00 em São Paulo
    for (let h = 0; h < 72; h++) {
      const t = base + h * 3600e3;
      const hr = h % 24;
      const temp = hr < 6 ? 16 : hr < 18 ? 27 : 20;
      const hum = hr >= 11 && hr < 15 ? 60 : 75;
      for (const [id, dt] of [['s1', 0], ['s2', 0], ['s3', 1.5]] as const) b.push({ sensorId: id, t, tAvg: temp + dt, tMin: temp, tMax: temp, hAvg: hum, hMin: hum, hMax: hum, n: 1 });
    }
    const r = weeklyInsights(b, c);
    const titles = r.map((x) => x.title).join(' | ');
    expect(titles).toContain('Noites frias');
    expect(titles).toContain('Ar seco');
    expect(titles).toContain('entre 11h e 15h');
    expect(titles).toContain('Sensor 3 difere');
    expect(r.find((x) => x.title.startsWith('Ar seco'))!.action).toContain('10h');
  });
});
