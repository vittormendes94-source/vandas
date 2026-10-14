import { describe, expect, it } from 'vitest';
import { toCsv } from '../src/csv';
import { downsampleForChart, findGaps, meanAcrossSensors, summarizePeriod, summarizeSeries } from '../src/history';
import { derivePumpStatus } from '../src/pump';
import { IngestReadingsBodySchema, prepareReadings } from '../src/ingest';
import { AppConfigSchema, defaultConfig } from '../src/config';
import { formatAge, localInputToUtc, startOfLocalDay, utcToLocalInput, zonedToUtc } from '../src/time';
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
  it('a configuração padrão é válida e não traz limites de alerta pré-definidos', () => {
    expect(AppConfigSchema.safeParse(defaultConfig()).success).toBe(true);
    expect(defaultConfig().alerts).toEqual({ temperature: { min: null, max: null }, humidity: { min: null, max: null }, dpv: { min: null, max: null } });
    expect(defaultConfig().pump).toEqual({ deviceId: null, outlet: 0 });
  });
  it('rejeita sensor fora dos limites, ids repetidos, limites invertidos e vínculos duplicados', () => {
    const c = defaultConfig();
    expect(AppConfigSchema.safeParse({ ...c, sensors: [{ ...c.sensors[0]!, xM: 12.5 }] }).success).toBe(false);
    expect(AppConfigSchema.safeParse({ ...c, sensors: [{ ...c.sensors[0]!, yM: -1 }] }).success).toBe(false);
    expect(AppConfigSchema.safeParse({ ...c, sensors: [c.sensors[0]!, c.sensors[0]!] }).success).toBe(false);
    expect(AppConfigSchema.safeParse({ ...c, alerts: { ...c.alerts, temperature: { min: 30, max: 20 } } }).success).toBe(false);
    expect(AppConfigSchema.safeParse({ ...c, freshness: { freshMaxMin: 60, offlineAfterMin: 30 } }).success).toBe(false);
    const dup = c.sensors.map((s) => ({ ...s, externalId: 'a1000abc' }));
    expect(AppConfigSchema.safeParse({ ...c, sensors: dup }).success).toBe(false);
    const pumpIsSensor = { ...c, sensors: [{ ...c.sensors[0]!, externalId: 'x1' }, c.sensors[1]!, c.sensors[2]!], pump: { deviceId: 'x1', outlet: 0 } };
    expect(AppConfigSchema.safeParse(pumpIsSensor).success).toBe(false);
    expect(AppConfigSchema.safeParse({ ...c, pump: { deviceId: 'id com espaço', outlet: 0 } }).success).toBe(false);
  });
});

describe('bomba: somente estado atual', () => {
  const now = Date.UTC(2026, 8, 30, 12, 0);
  it('mostra ligada/desligada só com comunicação confirmada e recente', () => {
    expect(derivePumpStatus({ linked: true, seenAt: now - 2 * MIN, online: true, switchState: 'on' }, now)).toMatchObject({ comm: 'ok', state: 'on' });
    expect(derivePumpStatus({ linked: true, seenAt: now - 2 * MIN, online: true, switchState: 'off' }, now)).toMatchObject({ comm: 'ok', state: 'off' });
  });
  it('Sonoff offline, integração parada, sem dados ou não vinculado → desconhecido (nunca "desligada")', () => {
    expect(derivePumpStatus({ linked: true, seenAt: now - MIN, online: false, switchState: 'off' }, now)).toMatchObject({ comm: 'offline', state: 'unknown' });
    expect(derivePumpStatus({ linked: true, seenAt: now - 30 * MIN, online: true, switchState: 'off' }, now)).toMatchObject({ comm: 'stale', state: 'unknown' });
    expect(derivePumpStatus({ linked: true, seenAt: null, online: null, switchState: null }, now)).toMatchObject({ comm: 'no_data', state: 'unknown' });
    expect(derivePumpStatus({ linked: false, seenAt: null, online: null, switchState: null }, now)).toMatchObject({ comm: 'not_linked', state: 'unknown' });
    expect(derivePumpStatus({ linked: true, seenAt: now - MIN, online: null, switchState: 'on' }, now)).toMatchObject({ comm: 'offline', state: 'unknown' });
  });
});

describe('média dos sensores ao longo do tempo', () => {
  const b = (sensorId: string, min: number, t: number, h: number, n = 1) => ({ sensorId, t: min * MIN, tAvg: t, tMin: t, tMax: t, hAvg: h, hMin: h, hMax: h, n });
  const ids = ['s1', 's2', 's3'];
  it('cada sensor pesa igual, mesmo enviando mais leituras', () => {
    const pts = meanAcrossSensors([b('s1', 1, 30, 50), b('s1', 2, 30, 50), b('s1', 3, 30, 50), b('s2', 4, 24, 70), b('s3', 5, 27, 60)], 'temperature', ids, 10 * MIN);
    expect(pts).toHaveLength(1);
    expect(pts[0]!.v).toBeCloseTo(27, 10);
    expect(pts[0]).toMatchObject({ lo: 24, hi: 30, n: 3, t: 5 * MIN });
  });
  it('intervalo sem todos os sensores vira lacuna (a média não salta quando um sensor falha)', () => {
    const pts = meanAcrossSensors([b('s1', 1, 30, 50), b('s2', 2, 24, 70), b('s1', 11, 30, 50), b('s2', 12, 24, 70), b('s3', 13, 27, 60)], 'humidity', ids, 10 * MIN);
    expect(pts.map((p) => p.t)).toEqual([15 * MIN]);
    expect(pts[0]!.v).toBeCloseTo(60, 10);
  });
  it('agregados horários ponderam pelo número de leituras dentro do sensor', () => {
    const pts = meanAcrossSensors([b('s1', 0, 20, 50, 1), b('s1', 30, 30, 50, 3)], 'temperature', ['s1'], 60 * MIN);
    expect(pts[0]!.v).toBeCloseTo(27.5, 10);
  });
  it('ignora sensores fora da lista e resume extremos', () => {
    const pts = meanAcrossSensors([b('s1', 1, 20, 50), b('s1', 11, 26, 50), b('s1', 21, 23, 50), b('zz', 1, 99, 99)], 'temperature', ['s1'], 10 * MIN);
    const s = summarizeSeries(pts)!;
    expect(s.max.v).toBe(26);
    expect(s.min.v).toBe(20);
    expect(s.last.v).toBe(23);
    expect(s.mean).toBeCloseTo(23, 10);
    expect(summarizeSeries([])).toBeNull();
  });
});
