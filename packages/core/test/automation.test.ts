import { describe, expect, it } from 'vitest';
import { AutomationConfigSchema, DEFAULT_AUTOMATION, decideAutomation, defaultConfig, emptyAutomationState, inchingWidthMs, parseStoredConfig } from '../src';
import type { AutomationInput, IrrigationAdvice } from '../src';

const MIN = 60_000;
const OK: IrrigationAdvice = { state: 'ok', reasons: [], missing: [], nextGood: null };
const NO: IrrigationAdvice = { state: 'no', reasons: ['Sol forte: 700 W/m² (limite 500)'], missing: [], nextGood: '16:00' };
const T0 = Date.UTC(2026, 9, 27, 10, 0); // 07:00 em São Paulo

const base = (over: Partial<AutomationInput> = {}): AutomationInput => ({
  cfg: { ...DEFAULT_AUTOMATION, schedule: ['07:00', '17:00'] },
  runMin: 5,
  pump: { comm: 'ok', state: 'off', seenAt: T0 - MIN },
  running: null,
  lastIrrigationAt: T0 - 10 * 60 * MIN,
  todayCount: 0,
  advice: OK,
  raining: false,
  humidityMean: 70,
  nowMs: T0,
  nowLocal: '2026-10-27T07:00',
  state: emptyAutomationState('2026-10-27'),
  ...over,
});

describe('automação da bomba', () => {
  it('no horário, com as regras ok: liga', () => {
    const d = decideAutomation(base());
    expect(d.command).toEqual({ action: 'on', reason: 'horário das 07:00', slot: '07:00' });
  });
  it('horário já resolvido não liga de novo', () => {
    const st = { ...emptyAutomationState('2026-10-27'), slots: { '07:00': { status: 'feito' as const, detail: '', at: T0 } } };
    expect(decideAutomation(base({ state: st, nowLocal: '2026-10-27T07:04', nowMs: T0 + 4 * MIN })).command).toBeNull();
  });
  it('sol forte no horário: adia e tenta de novo; depois do prazo, pula', () => {
    const d1 = decideAutomation(base({ advice: NO }));
    expect(d1.command).toBeNull();
    expect(d1.slots['07:00']).toMatchObject({ status: 'adiado', detail: 'Sol forte: 700 W/m² (limite 500)' });
    expect(d1.note).toContain('adiada');
    // 2 h depois as regras liberam: liga (ainda dentro de 180 min)
    const st = { ...emptyAutomationState('2026-10-27'), slots: d1.slots };
    const d2 = decideAutomation(base({ state: st, nowLocal: '2026-10-27T09:00', nowMs: T0 + 120 * MIN }));
    expect(d2.command?.action).toBe('on');
    // passou do prazo: pula
    const d3 = decideAutomation(base({ advice: NO, state: st, nowLocal: '2026-10-27T10:01', nowMs: T0 + 181 * MIN }));
    expect(d3.command).toBeNull();
    expect(d3.slots['07:00']).toMatchObject({ status: 'pulado' });
    expect(d3.slots['07:00']!.detail).toContain('Sol forte');
  });
  it('chuva e limite diário pulam o horário', () => {
    expect(decideAutomation(base({ raining: true })).slots['07:00']).toMatchObject({ status: 'pulado', detail: 'está chovendo' });
    expect(decideAutomation(base({ todayCount: 8 })).slots['07:00']).toMatchObject({ status: 'pulado' });
    expect(decideAutomation(base({ raining: true, cfg: { ...DEFAULT_AUTOMATION, schedule: ['07:00'], skipIfRaining: false } })).command?.action).toBe('on');
  });
  it('intervalo mínimo entre irrigações', () => {
    const d = decideAutomation(base({ lastIrrigationAt: T0 - 20 * MIN }));
    expect(d.command).toBeNull();
    expect(d.slots['07:00']).toMatchObject({ status: 'adiado' });
  });
  it('sem confirmação do estado da bomba: nunca liga nem desliga', () => {
    const d = decideAutomation(base({ pump: { comm: 'stale', state: 'unknown', seenAt: T0 - 20 * MIN } }));
    expect(d.command).toBeNull();
    expect(d.slots['07:00']?.status).toBe('adiado');
  });
  it('protege: desliga ao passar do tempo ou quando as regras proíbem (mesmo irrigação manual)', () => {
    const on = { comm: 'ok' as const, state: 'on' as const, seenAt: T0 };
    const now = { nowLocal: '2026-10-27T12:00', nowMs: T0 + 5 * 60 * MIN };
    expect(decideAutomation(base({ ...now, pump: on, running: { startedAt: now.nowMs - 5 * MIN } })).command).toMatchObject({ action: 'off', reason: 'passou do tempo de 5 min' });
    expect(decideAutomation(base({ ...now, pump: on, running: { startedAt: now.nowMs - 2 * MIN }, advice: NO })).command).toMatchObject({ action: 'off' });
    expect(decideAutomation(base({ ...now, pump: on, running: { startedAt: now.nowMs - 2 * MIN } })).command).toBeNull();
    // modo só proteção também desliga, mas nunca liga
    const prot = { ...DEFAULT_AUTOMATION, mode: 'protecao' as const, schedule: ['07:00'] };
    expect(decideAutomation(base({ ...now, cfg: prot, pump: on, running: { startedAt: now.nowMs - 6 * MIN } })).command?.action).toBe('off');
    expect(decideAutomation(base({ cfg: prot })).command).toBeNull();
    // desligado: nada
    expect(decideAutomation(base({ ...now, cfg: { ...prot, mode: 'desligado' }, pump: on, running: { startedAt: 0 } })).command).toBeNull();
  });
  it('bomba ligada por outro meio no horário: conta como feito', () => {
    const d = decideAutomation(base({ pump: { comm: 'ok', state: 'on', seenAt: T0 }, running: { startedAt: T0 - MIN } }));
    expect(d.slots['07:00']).toMatchObject({ status: 'feito' });
    expect(d.command).toBeNull();
  });
  it('depois de um comando, espera a confirmação (não repete)', () => {
    const st = { ...emptyAutomationState('2026-10-27'), lastCommand: { at: T0 - MIN, action: 'off' as const, reason: 'x', ok: true, error: null } };
    expect(decideAutomation(base({ state: st })).command).toBeNull();
  });
  it('irrigação extra por umidade baixa só com as regras avaliadas e ok', () => {
    const cfg = { ...DEFAULT_AUTOMATION, schedule: [], humidityBelowPct: 55 };
    const mid = { nowLocal: '2026-10-27T13:00', nowMs: T0 + 6 * 60 * MIN };
    expect(decideAutomation(base({ ...mid, cfg, humidityMean: 50 })).command?.action).toBe('on');
    expect(decideAutomation(base({ ...mid, cfg, humidityMean: 50, advice: { ...OK, state: 'unknown' } })).command).toBeNull();
    expect(decideAutomation(base({ ...mid, cfg, humidityMean: 60 })).command).toBeNull();
  });
  it('novo dia zera os horários; nota mostra o próximo', () => {
    const st = { ...emptyAutomationState('2026-10-26'), slots: { '07:00': { status: 'feito' as const, detail: '', at: 0 } } };
    expect(decideAutomation(base({ state: st })).command?.action).toBe('on');
    expect(decideAutomation(base({ nowLocal: '2026-10-27T06:00', nowMs: T0 - 60 * MIN })).note).toBe('Próxima irrigação: 07:00');
  });
  it('configuração e Inching', () => {
    expect(inchingWidthMs(5)).toBe(300_000);
    expect(AutomationConfigSchema.safeParse({ ...DEFAULT_AUTOMATION, schedule: ['07:00', '07:00'] }).success).toBe(false);
    const { automation: _a, ...old } = defaultConfig();
    expect(parseStoredConfig({ ...old, revision: 2 }).automation).toEqual(DEFAULT_AUTOMATION);
  });
});
