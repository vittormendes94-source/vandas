import { describe, expect, it } from 'vitest';
import { buildSnapshot, classifyFreshness, evaluateAlerts, latestAtOrBefore, snapshotAtInstant } from '../src/snapshot';
import { defaultConfig } from '../src/config';
import { MIN } from '../src/time';
import type { Reading } from '../src/types';

const NOW = Date.UTC(2026, 8, 30, 17, 0, 0);
// Configuração de teste explícita: fresh ≤ 15 min, offline > 60 min, limites de alerta definidos pelo teste.
const cfg = {
  ...defaultConfig(),
  freshness: { freshMaxMin: 15, offlineAfterMin: 60 },
  alerts: { temperature: { min: 18, max: 32 }, humidity: { min: 50, max: 85 }, dpv: { min: null, max: null } },
};

const reading = (sensorId: string, ageMin: number, t: number, h: number): Reading => ({
  sensorId,
  measuredAt: NOW - ageMin * MIN,
  receivedAt: NOW - ageMin * MIN + 2000,
  timeBasis: 'source',
  temperatureC: t,
  humidityPct: h,
  batteryPct: null,
  linkQuality: null,
  rssiDbm: null,
  source: 'test',
});

describe('classifyFreshness', () => {
  it('usa a idade da MEDIÇÃO', () => {
    const r = cfg.freshness;
    expect(classifyFreshness(NOW - 5 * MIN, NOW, r)).toBe('fresh');
    expect(classifyFreshness(NOW - 15 * MIN, NOW, r)).toBe('fresh');
    expect(classifyFreshness(NOW - 16 * MIN, NOW, r)).toBe('delayed');
    expect(classifyFreshness(NOW - 60 * MIN, NOW, r)).toBe('delayed');
    expect(classifyFreshness(NOW - 61 * MIN, NOW, r)).toBe('unavailable');
    expect(classifyFreshness(null, NOW, r)).toBe('unavailable');
  });
  it('atualizar a tela (avançar "agora") ENVELHECE a leitura, nunca a renova', () => {
    const m = NOW - 10 * MIN;
    expect(classifyFreshness(m, NOW, cfg.freshness)).toBe('fresh');
    expect(classifyFreshness(m, NOW + 10 * MIN, cfg.freshness)).toBe('delayed');
    expect(classifyFreshness(m, NOW + 60 * MIN, cfg.freshness)).toBe('unavailable');
  });
});

describe('buildSnapshot', () => {
  it('exclui sensores vencidos das médias e conta situações', () => {
    const latest = new Map<string, Reading | null>([
      ['s1', reading('s1', 3, 31, 54)],
      ['s2', reading('s2', 40, 20, 90)], // atrasado: fora das médias
      ['s3', null], // nunca leu
    ]);
    const snap = buildSnapshot(cfg, latest, NOW);
    expect(snap.counts).toEqual({ fresh: 1, delayed: 1, unavailable: 1 });
    expect(snap.temperature?.n).toBe(1);
    expect(snap.temperature?.mean).toBe(31);
    expect(snap.humidity?.mean).toBe(54);
    // o sensor atrasado ainda mostra sua leitura e seus derivados, mas não conta como válido
    const s2 = snap.sensors.find((s) => s.sensor.id === 's2')!;
    expect(s2.valid).toBe(false);
    expect(s2.reading?.temperatureC).toBe(20);
    expect(s2.dpvKpa).not.toBeNull();
  });

  it('calcula médias, extremos e diferença entre pontos com 3 sensores válidos', () => {
    const latest = new Map<string, Reading | null>([
      ['s1', reading('s1', 1, 31, 54)],
      ['s2', reading('s2', 1, 28, 63)],
      ['s3', reading('s3', 1, 26, 75)],
    ]);
    const snap = buildSnapshot(cfg, latest, NOW);
    expect(snap.temperature!.mean).toBeCloseTo(28.333, 2);
    expect(snap.temperature!.spread).toBe(5);
    expect(snap.temperature!.max).toEqual({ value: 31, sensorId: 's1' });
    expect(snap.temperature!.min).toEqual({ value: 26, sensorId: 's3' });
    expect(snap.humidity!.spread).toBe(21);
    // resumo de DPV = média dos DPV POR SENSOR (não o DPV da temperatura e umidade médias)
    const perSensor = snap.sensors.map((s) => s.dpvKpa!);
    expect(snap.dpv!.mean).toBeCloseTo(perSensor.reduce((a, b) => a + b, 0) / 3, 10);
  });

  it('sem nenhum sensor válido não há médias', () => {
    const snap = buildSnapshot(cfg, new Map(), NOW);
    expect(snap.temperature).toBeNull();
    expect(snap.lastMeasuredAt).toBeNull();
    expect(snap.counts.unavailable).toBe(3);
  });

  it('mantém measuredAt e receivedAt separados', () => {
    const r = reading('s1', 5, 25, 60);
    const snap = buildSnapshot(cfg, new Map([['s1', r]]), NOW);
    expect(snap.lastMeasuredAt).toBe(r.measuredAt);
    expect(snap.lastReceivedAt).toBe(r.receivedAt);
    expect(snap.lastReceivedAt).not.toBe(snap.lastMeasuredAt);
  });
});

describe('replay: leituras e tolerância', () => {
  const rs = [0, 5, 10, 15, 20].map((m) => reading('s1', 60 - m, 25 + m / 10, 60));
  it('latestAtOrBefore usa busca binária correta', () => {
    expect(latestAtOrBefore(rs, NOW - 100 * MIN)).toBeNull();
    expect(latestAtOrBefore(rs, NOW - 60 * MIN)?.measuredAt).toBe(NOW - 60 * MIN);
    expect(latestAtOrBefore(rs, NOW - 52 * MIN)?.measuredAt).toBe(NOW - 55 * MIN);
    expect(latestAtOrBefore(rs, NOW)?.measuredAt).toBe(NOW - 40 * MIN);
  });
  it('fora da tolerância o sensor fica indisponível no instante (sem preencher)', () => {
    const by = new Map([['s1', rs]]);
    const within = snapshotAtInstant(cfg, by, NOW - 38 * MIN, 15 * MIN);
    expect(within.sensors[0]!.freshness).toBe('fresh');
    const after = snapshotAtInstant(cfg, by, NOW - 20 * MIN, 15 * MIN); // última leitura há 20 min
    expect(after.sensors[0]!.freshness).toBe('unavailable');
    expect(after.temperature).toBeNull();
  });
});

describe('alertas configuráveis', () => {
  it('sem limites não há alertas; com limites só sensores válidos entram', () => {
    const latest = new Map<string, Reading | null>([
      ['s1', reading('s1', 1, 35, 40)],
      ['s2', reading('s2', 40, 40, 10)], // atrasado: ignorado
    ]);
    const snap = buildSnapshot(cfg, latest, NOW);
    const none = { temperature: { min: null, max: null }, humidity: { min: null, max: null }, dpv: { min: null, max: null } };
    expect(evaluateAlerts(snap, none)).toEqual([]);
    const hits = evaluateAlerts(snap, cfg.alerts);
    expect(hits.map((h) => `${h.sensorId}:${h.kind}:${h.direction}`).sort()).toEqual(['s1:humidity:below', 's1:temperature:above']);
  });
});
