import { describe, expect, it } from 'vitest';
import { compareAroundEvents, deriveRelayStatus, derivePeriods } from '../src/irrigation';
import { MIN } from '../src/time';
import type { Reading } from '../src/types';

const T0 = Date.UTC(2026, 8, 30, 10, 0, 0);
const m = (n: number) => T0 + n * MIN;

describe('derivePeriods', () => {
  it('pareia ligado/desligado, ignora repetições e mantém período aberto', () => {
    const p = derivePeriods([
      { at: m(0), state: 'on' },
      { at: m(1), state: 'on' }, // repetido
      { at: m(5), state: 'off' },
      { at: m(6), state: 'off' }, // repetido
      { at: m(60), state: 'on' },
    ]);
    expect(p).toEqual([
      { startedAt: m(0), endedAt: m(5) },
      { startedAt: m(60), endedAt: null },
    ]);
  });
  it('ordena mensagens fora de ordem', () => {
    const p = derivePeriods([
      { at: m(5), state: 'off' },
      { at: m(0), state: 'on' },
    ]);
    expect(p).toEqual([{ startedAt: m(0), endedAt: m(5) }]);
  });
  it('"desligado" sem "ligado" anterior não cria período', () => {
    expect(derivePeriods([{ at: m(1), state: 'off' }])).toEqual([]);
  });
});

describe('deriveRelayStatus', () => {
  const now = m(100);
  it('sem comunicação NÃO significa desligado', () => {
    const s = deriveRelayStatus({ lastState: 'off', lastStateAt: m(0), lastSeenAt: m(0), online: null }, now, 30);
    expect(s.comm).toBe('lost');
    expect(s.state).toBe('unknown');
    expect(s.lastKnownState).toBe('off');
  });
  it('nunca recebeu dados → no_data', () => {
    expect(deriveRelayStatus({ lastState: null, lastStateAt: null, lastSeenAt: null, online: null }, now, 30).comm).toBe('no_data');
  });
  it('online=false informado pela origem = sem comunicação', () => {
    expect(deriveRelayStatus({ lastState: 'on', lastStateAt: m(99), lastSeenAt: m(99), online: false }, now, null).comm).toBe('lost');
  });
  it('dentro do prazo mostra o estado informado', () => {
    const s = deriveRelayStatus({ lastState: 'on', lastStateAt: m(95), lastSeenAt: m(95), online: true }, now, 30);
    expect(s).toMatchObject({ comm: 'ok', state: 'on' });
  });
  it('sem limite de idade configurado não infere perda por tempo', () => {
    expect(deriveRelayStatus({ lastState: 'off', lastStateAt: m(0), lastSeenAt: m(0), online: null }, m(10_000), null).comm).toBe('ok');
  });
});

const rd = (min: number, t: number, h: number, sensorId = 's1'): Reading => ({
  sensorId,
  measuredAt: m(min),
  receivedAt: m(min),
  timeBasis: 'source',
  temperatureC: t,
  humidityPct: h,
  batteryPct: null,
  linkQuality: null,
  rssiDbm: null,
  source: 't',
});

describe('compareAroundEvents (variação observada, sem causalidade)', () => {
  const period = [{ startedAt: m(60), endedAt: m(65) }];
  it('calcula depois − antes por sensor', () => {
    const readings = [rd(40, 30, 60), rd(50, 30, 60), rd(66, 28, 70), rd(80, 28.5, 68)];
    const [ev] = compareAroundEvents(readings, period, ['s1'], 30 * MIN);
    expect(ev!.sufficient).toBe(true);
    expect(ev!.sensors[0]!.deltaT).toBeCloseTo(-1.75, 6);
    expect(ev!.sensors[0]!.deltaH).toBeCloseTo(9, 6); // (70 + 68) / 2 − 60
  });
  it('dados insuficientes numa das janelas → sem delta', () => {
    const readings = [rd(40, 30, 60), rd(50, 30, 60), rd(66, 28, 70)]; // só 1 depois
    const [ev] = compareAroundEvents(readings, period, ['s1'], 30 * MIN);
    expect(ev!.sensors[0]!.deltaT).toBeNull();
    expect(ev!.sufficient).toBe(false);
  });
  it('não considera períodos abertos', () => {
    expect(compareAroundEvents([], [{ startedAt: m(0), endedAt: null }], ['s1'], 30 * MIN)).toEqual([]);
  });
  it('recorta janelas para não invadir outro evento', () => {
    const two = [
      { startedAt: m(60), endedAt: m(65) },
      { startedAt: m(80), endedAt: m(85) },
    ];
    const [a, b] = compareAroundEvents([], two, ['s1'], 30 * MIN);
    expect(a!.afterWindow.to).toBe(m(80)); // recortada em vez de m(95)
    expect(b!.beforeWindow.from).toBe(m(65)); // recortada em vez de m(50)
  });
  it('ignora leituras de sensores que não são pedidos', () => {
    const [ev] = compareAroundEvents([rd(50, 1, 1, 'zz')], period, ['s1'], 30 * MIN);
    expect(ev!.sensors).toHaveLength(1);
  });
});
