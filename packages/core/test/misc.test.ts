import { describe, expect, it } from 'vitest';
import { toCsv } from '../src/csv';
import { downsampleForChart, findGaps, summarizePeriod } from '../src/history';
import { IngestReadingsBodySchema, prepareReadings } from '../src/ingest';
import { AppConfigSchema, defaultConfig } from '../src/config';
import { formatAge, localInputToUtc, startOfLocalDay, utcToLocalInput, zonedToUtc } from '../src/time';
import { DEMO_SAMPLE_INTERVAL_MS, DEMO_SENSORS, demoIrrigationPeriods, generateDemoReadings, isDemoOutage } from '../src/simulator';
import { DAY, HOUR, MIN } from '../src/time';

describe('fuso horário America/Sao_Paulo', () => {
  it('meio-dia local = 15:00 UTC (UTC−3)', () => {
    expect(zonedToUtc(2026, 9, 30, 12, 0)).toBe(Date.UTC(2026, 8, 30, 15, 0));
  });
  it('ida e volta com <input datetime-local>', () => {
    const utc = Date.UTC(2026, 8, 30, 17, 5);
    expect(utcToLocalInput(utc)).toBe('2026-09-30T14:05');
    expect(localInputToUtc('2026-09-30T14:05')).toBe(utc);
    expect(localInputToUtc('lixo')).toBeNull();
  });
  it('início do dia local', () => {
    expect(startOfLocalDay(Date.UTC(2026, 8, 30, 2, 0))).toBe(Date.UTC(2026, 8, 29, 3, 0)); // 23:00 do dia 29 local
  });
  it('formatAge', () => {
    expect(formatAge(5 * MIN)).toBe('há 5 min');
    expect(formatAge(125 * MIN)).toBe('há 2 h 05 min');
    expect(formatAge(null)).toBe('—');
  });
});

describe('CSV', () => {
  it('escapa aspas/separadores, neutraliza fórmulas e usa CRLF', () => {
    const csv = toCsv(['a', 'b'], [['x,"y"', '=CMD()'], [1.5, null]], { bom: false });
    expect(csv).toBe('a,b\r\n"x,""y""",\'=CMD()\r\n1.5,\r\n');
  });
  it('separador ; e vírgula decimal para Excel pt-BR', () => {
    expect(toCsv(['n'], [[1.5]], { delimiter: ';', decimalComma: true, bom: false })).toBe('n\r\n1,5\r\n');
  });
  it('números negativos continuam numéricos (sem apóstrofo)', () => {
    expect(toCsv(['n'], [[-3.2]], { bom: false })).toBe('n\r\n-3.2\r\n');
  });
});

describe('histórico', () => {
  it('findGaps detecta lacunas acima do limite e não as preenche', () => {
    const pts = [0, 5, 10, 70, 75].map((m) => ({ t: m * MIN }));
    expect(findGaps(pts, 's1', 15 * MIN)).toEqual([{ sensorId: 's1', from: 10 * MIN, to: 70 * MIN }]);
  });
  it('summarizePeriod usa mín/máx dos buckets', () => {
    const s = summarizePeriod([
      { sensorId: 's1', t: 0, tAvg: 25, tMin: 22, tMax: 28, hAvg: 60, hMin: 50, hMax: 70, n: 12 },
      { sensorId: 's2', t: HOUR, tAvg: 26, tMin: 24, tMax: 30, hAvg: 55, hMin: 45, hMax: 65, n: 12 },
    ]);
    expect(s.temperature!.min).toMatchObject({ value: 22, sensorId: 's1' });
    expect(s.temperature!.max).toMatchObject({ value: 30, sensorId: 's2' });
    expect(s.humidity!.min).toMatchObject({ value: 45, sensorId: 's2' });
    expect(s.samples).toBe(24);
    expect(summarizePeriod([]).temperature).toBeNull();
  });
  it('downsampleForChart preserva picos e só usa pontos existentes', () => {
    const series = Array.from({ length: 5000 }, (_, i) => ({ t: i, v: i === 2500 ? 99 : Math.sin(i / 50) }));
    const out = downsampleForChart(series, (p) => p.v, 200);
    expect(out.length).toBeLessThan(500);
    expect(out.some((p) => p.v === 99)).toBe(true);
    for (const p of out) expect(series[p.t]).toBe(p);
  });
});

describe('contrato de ingestão', () => {
  const NOW = Date.UTC(2026, 8, 30, 17, 0, 0);
  const known = new Set(['s1', 's2']);
  const body = (readings: unknown[]) => IngestReadingsBodySchema.parse({ source: 'esp32', readings });

  it('normaliza e separa measuredAt de receivedAt', () => {
    const { prepared } = prepareReadings(body([{ sensorId: 's1', measuredAt: '2026-09-30T16:58:00Z', temperatureC: 27.4, humidityPct: 68.2 }]), known, NOW, 45);
    expect(prepared[0]!.reading).toMatchObject({ measuredAt: Date.UTC(2026, 8, 30, 16, 58), receivedAt: NOW, timeBasis: 'source', batteryPct: null });
  });
  it('sem measuredAt usa o horário de recebimento e marca a base', () => {
    const { prepared } = prepareReadings(body([{ sensorId: 's1', temperatureC: 20, humidityPct: 50 }]), known, NOW, 45);
    expect(prepared[0]!.reading).toMatchObject({ measuredAt: NOW, timeBasis: 'received' });
  });
  it('rejeita sensor desconhecido, futuro e antigo demais', () => {
    const { prepared, rejected } = prepareReadings(
      body([
        { sensorId: 'zz', temperatureC: 20, humidityPct: 50 },
        { sensorId: 's1', measuredAt: '2026-09-30T18:00:00Z', temperatureC: 20, humidityPct: 50 },
        { sensorId: 's1', measuredAt: '2026-06-01T00:00:00Z', temperatureC: 20, humidityPct: 50 },
        { sensorId: 's2', measuredAt: '2026-09-30T17:03:00Z', temperatureC: 20, humidityPct: 50 }, // +3 min: tolerado
      ]),
      known,
      NOW,
      45,
    );
    expect(rejected.map((r) => (r.status === 'rejected' ? r.reason : ''))).toEqual(['unknown_sensor', 'future_timestamp', 'too_old']);
    expect(prepared).toHaveLength(1);
  });
  it('o schema recusa valores físicos impossíveis, campos extras e lotes vazios', () => {
    expect(() => body([{ sensorId: 's1', temperatureC: 200, humidityPct: 50 }])).toThrow();
    expect(() => body([{ sensorId: 's1', temperatureC: 20, humidityPct: 101 }])).toThrow();
    expect(() => body([{ sensorId: 's1', temperatureC: 20, humidityPct: 50, extra: 1 }])).toThrow();
    expect(() => body([])).toThrow();
    expect(() => body([{ sensorId: 'S 1', temperatureC: 20, humidityPct: 50 }])).toThrow();
    expect(() => body([{ sensorId: 's1', measuredAt: 'ontem', temperatureC: 20, humidityPct: 50 }])).toThrow();
  });
});

describe('configuração', () => {
  it('a configuração padrão (demo e real) é válida', () => {
    expect(AppConfigSchema.safeParse(defaultConfig('demo')).success).toBe(true);
    expect(AppConfigSchema.safeParse(defaultConfig('real')).success).toBe(true);
  });
  it('modo real não traz limites de alerta pré-definidos', () => {
    expect(defaultConfig('real').alerts).toMatchObject({ temperature: { min: null, max: null }, demonstrative: false });
    expect(defaultConfig('demo').alerts.demonstrative).toBe(true);
  });
  it('rejeita sensor fora dos limites do orquidário, ids repetidos e limites invertidos', () => {
    const c = defaultConfig('demo');
    expect(AppConfigSchema.safeParse({ ...c, sensors: [{ ...c.sensors[0]!, xM: 12.5 }] }).success).toBe(false);
    expect(AppConfigSchema.safeParse({ ...c, sensors: [{ ...c.sensors[0]!, yM: -1 }] }).success).toBe(false);
    expect(AppConfigSchema.safeParse({ ...c, sensors: [c.sensors[0]!, c.sensors[0]!] }).success).toBe(false);
    expect(AppConfigSchema.safeParse({ ...c, alerts: { ...c.alerts, temperature: { min: 30, max: 20 } } }).success).toBe(false);
    expect(AppConfigSchema.safeParse({ ...c, freshness: { freshMaxMin: 60, offlineAfterMin: 30 } }).success).toBe(false);
  });
});

describe('simulador de demonstração', () => {
  const from = Date.UTC(2026, 8, 20, 3, 0);
  const to = from + 7 * DAY;
  const all = generateDemoReadings(from, to);

  it('é determinístico (mesma janela → mesmas leituras)', () => {
    expect(generateDemoReadings(from, to)).toEqual(all);
  });
  it('gerar em partes equivale a gerar de uma vez', () => {
    const cut = from + 3 * DAY + 17 * MIN;
    expect([...generateDemoReadings(from, cut), ...generateDemoReadings(cut, to)]).toEqual(all);
  });
  it('tem ≥ 7 dias, 3 setores e valores plausíveis com diferença entre setores', () => {
    expect(new Set(all.map((r) => r.sensorId))).toEqual(new Set(DEMO_SENSORS.map((s) => s.id)));
    const mean = (id: string, f: (r: (typeof all)[number]) => number) => {
      const xs = all.filter((r) => r.sensorId === id).map(f);
      return xs.reduce((a, b) => a + b, 0) / xs.length;
    };
    expect(mean('s1', (r) => r.temperatureC)).toBeGreaterThan(mean('s3', (r) => r.temperatureC) + 2);
    expect(mean('s3', (r) => r.humidityPct)).toBeGreaterThan(mean('s1', (r) => r.humidityPct) + 8);
    for (const r of all) {
      expect(r.temperatureC).toBeGreaterThan(10);
      expect(r.temperatureC).toBeLessThan(40);
      expect(r.humidityPct).toBeGreaterThanOrEqual(20);
      expect(r.humidityPct).toBeLessThanOrEqual(99);
    }
  });
  it('varia entre dia e noite', () => {
    const s2 = all.filter((r) => r.sensorId === 's2');
    const at = (h: number) => s2.filter((r) => Math.floor((((r.measuredAt - 3 * HOUR) % DAY) + DAY) % DAY / HOUR) === h).map((r) => r.temperatureC);
    const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(avg(at(14))).toBeGreaterThan(avg(at(3)) + 4);
  });
  it('contém falhas de comunicação (lacunas) e irrigações', () => {
    const s2 = all.filter((r) => r.sensorId === 's2').map((r) => ({ t: r.measuredAt }));
    expect(findGaps(s2, 's2', 4 * DEMO_SAMPLE_INTERVAL_MS).length).toBeGreaterThan(0);
    expect(demoIrrigationPeriods(from, to).length).toBeGreaterThanOrEqual(10);
    expect([0, 1, 2].some((i) => isDemoOutage(i, from + 20 * HOUR))).toBeDefined();
  });
  it('leituras não têm duplicidade de (sensor, instante) e receivedAt ≥ measuredAt', () => {
    const keys = new Set(all.map((r) => `${r.sensorId}@${r.measuredAt}`));
    expect(keys.size).toBe(all.length);
    for (const r of all) expect(r.receivedAt).toBeGreaterThan(r.measuredAt);
  });
});
