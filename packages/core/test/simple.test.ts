import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../src/config';
import { buildSnapshot } from '../src/snapshot';
import { simplePump, simpleStatus, todayExtremes, valueTone } from '../src/simple';
import { HOUR, MIN } from '../src/time';
import type { AppConfig, Reading } from '../src/types';

const NOW = Date.UTC(2026, 9, 26, 15, 0);
const r = (sensorId: string, t: number, h: number, ageMs = 2 * MIN): Reading => ({
  sensorId,
  measuredAt: NOW - ageMs,
  receivedAt: NOW - ageMs,
  timeBasis: 'received',
  temperatureC: t,
  humidityPct: h,
  batteryPct: null,
  linkQuality: null,
  rssiDbm: null,
  source: 'switchbot',
});
const cfg = (limits = false): AppConfig => {
  const c = defaultConfig();
  c.sensors.forEach((s, i) => (s.externalId = `dev${i}`));
  if (limits) {
    c.alerts.temperature = { min: 15, max: 32 };
    c.alerts.humidity = { min: 55, max: 90 };
  }
  return c;
};
const snap = (c: AppConfig, readings: (Reading | null)[]) =>
  buildSnapshot(c, new Map(c.sensors.map((s, i) => [s.id, readings[i] ?? null])), NOW);

describe('visão simples', () => {
  it('sem nenhuma leitura: aguardando (não inventa "tudo certo")', () => {
    const c = defaultConfig();
    expect(simpleStatus(snap(c, [null, null, null]), c, NOW)).toMatchObject({ level: 'setup', headline: 'Aguardando os sensores' });
  });

  it('todos parados há muito tempo: vermelho com a idade', () => {
    const c = cfg();
    const s = simpleStatus(snap(c, [r('s1', 25, 70, 5 * HOUR), r('s2', 25, 70, 5 * HOUR), r('s3', 25, 70, 5 * HOUR)]), c, NOW);
    expect(s.level).toBe('bad');
    expect(s.headline).toBe('Sem notícias dos sensores há 5 h 00 min');
  });

  it('tudo atualizado e dentro das faixas: verde', () => {
    const c = cfg(true);
    expect(simpleStatus(snap(c, [r('s1', 25, 70), r('s2', 26, 72), r('s3', 24, 75)]), c, NOW)).toMatchObject({ level: 'ok', headline: 'Tudo certo no orquidário' });
  });

  it('sem faixas definidas: verde neutro, pedindo para definir', () => {
    const c = cfg(false);
    const s = simpleStatus(snap(c, [r('s1', 25, 70), r('s2', 26, 72), r('s3', 24, 75)]), c, NOW);
    expect(s).toMatchObject({ level: 'ok', headline: 'Sensores funcionando' });
    expect(s.details[0]).toMatch(/faixas/);
  });

  it('quente em todos e seco em um: amarelo, com o pior valor e onde', () => {
    const c = cfg(true);
    const s = simpleStatus(snap(c, [r('s1', 33, 70), r('s2', 35.2, 50), r('s3', 34, 75)]), c, NOW);
    expect(s.level).toBe('warn');
    expect(s.headline).toBe('Atenção: está quente');
    expect(s.details[0]).toBe('Está quente: 35,2 °C (em todo o orquidário; limite 32,0 °C)');
    expect(s.details[1]).toBe('Ar seco: 50 % (Sensor 2; limite 55 %)');
  });

  it('um sensor sem sinal: amarelo, sem tirar os outros da avaliação', () => {
    const c = cfg(true);
    const s = simpleStatus(snap(c, [r('s1', 25, 70), r('s2', 25, 70, 4 * HOUR), r('s3', 25, 70)]), c, NOW);
    expect(s).toMatchObject({ level: 'warn', headline: '2 de 3 sensores funcionando' });
    expect(s.details).toContain('Sensor 2 sem sinal há 4 h 00 min');
  });

  it('valor contra a faixa', () => {
    const l = { min: 15, max: 32 };
    expect([valueTone(10, l), valueTone(20, l), valueTone(40, l), valueTone(null, l), valueTone(20, { min: null, max: null })]).toEqual(['low', 'ok', 'high', 'none', 'none']);
  });

  it('bomba: fora do ar nunca vira "desligada"', () => {
    const base = { seenAt: new Date(NOW - MIN).toISOString(), deviceName: 'Bomba' };
    expect(simplePump({ ...base, comm: 'ok', state: 'on' }, NOW).tone).toBe('on');
    expect(simplePump({ ...base, comm: 'ok', state: 'off' }, NOW).tone).toBe('off');
    expect(simplePump({ ...base, comm: 'offline', state: 'unknown' }, NOW)).toMatchObject({ tone: 'unknown', label: 'Bomba: sem informação' });
    expect(simplePump({ ...base, comm: 'not_linked', state: 'unknown' }, NOW).tone).toBe('none');
  });

  it('mínima e máxima do dia', () => {
    expect(todayExtremes([{ rows: [[1, 20, 80], [2, 31.5, 60]] }, { rows: [[1, 18.2, 90]] }])).toEqual({ tMin: 18.2, tMax: 31.5, hMin: 60, hMax: 90 });
    expect(todayExtremes([])).toEqual({ tMin: null, tMax: null, hMin: null, hMax: null });
  });
});

import { formatIrrigationDuration, irrigationAction, summarizeIrrigations } from '../src/irrigation';
describe('irrigações (transições da bomba)', () => {
  const ok = (state: 'on' | 'off') => ({ comm: 'ok' as const, state, seenAt: NOW });
  const lost = { comm: 'offline' as const, state: 'unknown' as const, seenAt: NOW - HOUR };
  it('liga → começa; continua ligada → atualiza; desliga → termina', () => {
    expect(irrigationAction(null, ok('on'), NOW)).toEqual({ kind: 'start', at: NOW });
    expect(irrigationAction({ startedAt: NOW - 4 * MIN, lastOnAt: NOW - 2 * MIN }, ok('on'), NOW)).toEqual({ kind: 'continue', at: NOW });
    expect(irrigationAction({ startedAt: NOW - 4 * MIN, lastOnAt: NOW - 2 * MIN }, ok('off'), NOW)).toEqual({ kind: 'end', endedAt: NOW, reason: 'off' });
    expect(irrigationAction(null, ok('off'), NOW)).toEqual({ kind: 'none' });
  });
  it('mesma leitura processada duas vezes não altera nada; horário vem da leitura do Sonoff', () => {
    expect(irrigationAction({ startedAt: NOW - 4 * MIN, lastOnAt: NOW }, ok('on'), NOW + 5 * MIN)).toEqual({ kind: 'none' });
    expect(irrigationAction(null, { comm: 'ok', state: 'on', seenAt: NOW - MIN }, NOW)).toEqual({ kind: 'start', at: NOW - MIN });
  });
  it('sem sinal: não presume que desligou; após 30 min fecha no último "ligada" visto', () => {
    expect(irrigationAction({ startedAt: NOW - 20 * MIN, lastOnAt: NOW - 10 * MIN }, lost, NOW)).toEqual({ kind: 'none' });
    expect(irrigationAction({ startedAt: NOW - 50 * MIN, lastOnAt: NOW - 40 * MIN }, lost, NOW)).toEqual({ kind: 'end', endedAt: NOW - 40 * MIN, reason: 'sem_sinal' });
    expect(irrigationAction(null, lost, NOW)).toEqual({ kind: 'none' });
  });
  it('resumo do dia e duração legível', () => {
    const ev = (startMin: number, durMin: number) => ({ startedAt: new Date(NOW - startMin * MIN).toISOString(), endedAt: new Date(NOW - (startMin - durMin) * MIN).toISOString(), lastOnAt: new Date(NOW - (startMin - durMin) * MIN).toISOString(), endReason: 'off' as const, durationMs: durMin * MIN });
    const s = summarizeIrrigations([ev(600, 10), ev(120, 6), ev(30 * 60, 8)], NOW - 12 * HOUR, 2);
    expect(s.todayCount).toBe(2);
    expect(s.todayTotalMs).toBe(16 * MIN);
    expect(s.last.map((e) => e.durationMs)).toEqual([6 * MIN, 10 * MIN]);
    expect([formatIrrigationDuration(60_000), formatIrrigationDuration(12 * MIN), formatIrrigationDuration(65 * MIN)]).toEqual(['menos de 2 min', '12 min', '1 h 05 min']);
  });
});

import { trendOf } from '../src/simple';
describe('tendência (média dos sensores na última hora)', () => {
  const pts = (vals: number[], stepMin = 15) => vals.map((v, i) => ({ t: NOW - (vals.length - 1 - i) * stepMin * MIN, v }));
  it('subindo, descendo e estável', () => {
    expect(trendOf(pts([24, 24.5, 25, 25.5, 26]), 0.5, NOW)).toMatchObject({ dir: 'up', perHour: 2 });
    expect(trendOf(pts([80, 78, 76, 74, 72]), 3, NOW)).toMatchObject({ dir: 'down', perHour: -8 });
    expect(trendOf(pts([25, 25.1, 25, 25.2, 25.1]), 0.5, NOW)?.dir).toBe('flat');
  });
  it('sem dados suficientes ou dados velhos: sem seta', () => {
    expect(trendOf(pts([25, 26]), 0.5, NOW)).toBeNull(); // só 15 min de diferença
    expect(trendOf(pts([24, 25, 26, 27, 28]), 0.5, NOW + 2 * HOUR)).toBeNull();
    expect(trendOf([], 0.5, NOW)).toBeNull();
  });
});

import { irrigationsByDay } from '../src/irrigation';
import { startOfLocalDay } from '../src/time';
it('irrigações: totais por dia no fuso de São Paulo', () => {
  const ev = (iso: string, durMin: number) => ({ startedAt: iso, endedAt: iso, lastOnAt: iso, endReason: 'off' as const, durationMs: durMin * MIN });
  // 02:30 UTC de 26/10 ainda é dia 25 em São Paulo (23:30).
  const r = irrigationsByDay([ev('2026-10-26T12:00:00Z', 10), ev('2026-10-26T02:30:00Z', 5), ev('2026-10-25T20:00:00Z', 7)], (ms) => startOfLocalDay(ms));
  expect(r).toEqual([
    { dayStart: Date.UTC(2026, 9, 26, 3), count: 1, totalMs: 10 * MIN },
    { dayStart: Date.UTC(2026, 9, 25, 3), count: 2, totalMs: 12 * MIN },
  ]);
});
