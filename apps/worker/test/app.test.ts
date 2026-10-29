import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DAY, HOUR, MIN, defaultConfig, localDateTimeString } from '@orq/core';
import type { AppConfig, HistoryResponse, LiveResponse, ProviderDeviceDto } from '@orq/core';
import { app } from '../src/app';
import type { Env } from '../src/env';
import { hmacBase64, parseThing, pollEwelink } from '../src/ewelink';
import { runScheduled } from '../src/index';
import { logError, redact } from '../src/logging';
import { applyRetention, getConfig, persistReadings, saveConfig } from '../src/repo';
import { createTestDb } from './d1-shim';
// @ts-expect-error módulo JS de teste
import { climateThing, createEwelinkMock, switchThing } from './ewelink-mock.mjs';
// @ts-expect-error módulo JS de teste
import { createSwitchbotMock, hubMini, outdoorMeter } from './switchbot-mock.mjs';
import { pollSwitchbot, switchbotSign } from '../src/switchbot';

const ADMIN = 'admin-token-de-teste-123';
const INGEST = 'ingest-token-de-teste-456';
const VIEW = 'view-token-de-teste-789';
const APP_ID = 'AppIdDeTeste1234567890';
const APP_SECRET = 'SegredoDoAppDeTeste0987654321abcd';

let env: Env;
beforeEach(() => {
  env = {
    DB: createTestDb(),
    ADMIN_TOKEN: ADMIN,
    INGEST_TOKEN: INGEST,
    EWELINK_APP_ID: APP_ID,
    EWELINK_APP_SECRET: APP_SECRET,
    EWELINK_REDIRECT_URL: 'https://orquidario.test/api/ewelink/callback',
    EWELINK_API_BASE_OVERRIDE: 'https://mock.ewelink.test',
    EWELINK_OAUTH_URL_OVERRIDE: 'https://mock.ewelink.test/oauth/index.html',
  } as Env;
});
afterEach(() => vi.unstubAllGlobals());

const call = (path: string, init?: RequestInit, e: Env = env) => app.request(path, init, e);
const post = (path: string, body: unknown, token: string | null = INGEST, e: Env = env) =>
  call(path, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: typeof body === 'string' ? body : JSON.stringify(body) }, e);
const reading = (over: Record<string, unknown> = {}) => ({ sensorId: 's1', temperatureC: 27.4, humidityPct: 68.2, ...over });
const ingest = (readings: unknown[], token: string | null = INGEST) => post('/api/v1/ingest/readings', { source: 'teste', readings }, token);
const iso = (ms: number) => new Date(ms).toISOString();
const live = async (e: Env = env) => (await (await call('/api/live', undefined, e)).json()) as LiveResponse;

describe('autenticação e acesso', () => {
  it('ingestão: sem token 401, token errado 401, sem INGEST_TOKEN 503', async () => {
    expect((await ingest([reading()], null)).status).toBe(401);
    expect((await ingest([reading()], 'errado')).status).toBe(401);
    expect((await post('/api/v1/ingest/readings', { source: 'x', readings: [reading()] }, INGEST, { ...env, INGEST_TOKEN: undefined } as Env)).status).toBe(503);
  });
  it('token de visualização não grava configuração, não conecta eWeLink e não ingere', async () => {
    const e = { ...env, VIEW_TOKEN: VIEW } as Env;
    expect((await call('/api/config', { method: 'PUT', headers: { authorization: `Bearer ${VIEW}` }, body: JSON.stringify(defaultConfig()) }, e)).status).toBe(401);
    expect((await post('/api/ewelink/authorize', {}, VIEW, e)).status).toBe(401);
    expect((await post('/api/v1/ingest/readings', { source: 'x', readings: [reading()] }, VIEW, e)).status).toBe(401);
  });
  it('com VIEW_TOKEN a leitura exige token (header ou ?k=); sem ele a API é aberta', async () => {
    const e = { ...env, VIEW_TOKEN: VIEW } as Env;
    expect((await call('/api/live', undefined, e)).status).toBe(401);
    expect((await call('/api/live', { headers: { 'x-view-token': VIEW } }, e)).status).toBe(200);
    expect((await call(`/api/live?k=${VIEW}`, undefined, e)).status).toBe(200);
    expect((await call('/api/live', { headers: { authorization: `Bearer ${INGEST}` } }, e)).status).toBe(401);
    expect((await call('/api/live')).status).toBe(200);
  });
  it('/api/health e /api/meta são abertos e não vazam segredos', async () => {
    const text = await (await call('/api/meta', undefined, { ...env, VIEW_TOKEN: VIEW } as Env)).text();
    expect(text).toContain('"viewProtected":true');
    for (const s of [ADMIN, INGEST, VIEW, APP_SECRET, APP_ID]) expect(text).not.toContain(s);
  });
});

describe('sem dados: nada é inventado', () => {
  it('sistema novo não mostra leitura nenhuma e a bomba fica "não vinculada" (estado desconhecido)', async () => {
    const l = await live();
    expect(Object.values(l.latest).every((r) => r === null)).toBe(true);
    expect(l.pump).toMatchObject({ comm: 'not_linked', state: 'unknown' });
    expect(l.integration.ewelink).toMatchObject({ configured: true, connected: false });
  });
});

describe('ingestão genérica (ESP32/scripts)', () => {
  it('guarda measuredAt e receivedAt separados, idempotente, fora de ordem sem trocar a mais recente', async () => {
    const newer = Date.now() - 2 * MIN;
    const older = Date.now() - 20 * MIN;
    expect(await (await ingest([reading({ measuredAt: iso(newer), temperatureC: 30, batteryPct: 91 })])).json()).toMatchObject({ accepted: 1 });
    expect(await (await ingest([reading({ measuredAt: iso(newer), temperatureC: 30 })])).json()).toMatchObject({ accepted: 0, duplicates: 1 });
    await ingest([reading({ measuredAt: iso(older), temperatureC: 22 })]);
    const l = await live();
    expect(l.latest.s1).toMatchObject({ temperatureC: 30, batteryPct: 91, timeBasis: 'source' });
    expect(Date.parse(l.latest.s1!.measuredAt)).toBe(newer);
    expect(Date.parse(l.latest.s1!.receivedAt)).toBeGreaterThan(newer);
    const h = (await (await call(`/api/history?from=${iso(Date.now() - HOUR)}&to=${iso(Date.now())}`)).json()) as HistoryResponse;
    expect(h.series[0]!.rows.map((r) => r[1])).toEqual([22, 30]);
  });
  it('rejeita sensor desconhecido, futuro e antigo demais; payload inválido 400; corpo enorme 413', async () => {
    const res = (await (
      await ingest([reading({ sensorId: 'zz' }), reading({ measuredAt: iso(Date.now() + HOUR) }), reading({ measuredAt: iso(Date.now() - 200 * DAY) }), reading({ measuredAt: iso(Date.now() - MIN) })])
    ).json()) as { results: { status: string; reason?: string }[] };
    expect(res.results.map((r) => r.reason ?? r.status)).toEqual(['unknown_sensor', 'future_timestamp', 'too_old', 'accepted']);
    expect((await ingest([reading({ temperatureC: 999 })])).status).toBe(400);
    expect((await post('/api/v1/ingest/readings', '{nao json')).status).toBe(400);
    expect((await post('/api/v1/ingest/readings', 'x'.repeat(70_000))).status).toBe(413);
  });
  it('agrega por hora de forma idempotente e recalcula com dados fora de ordem', async () => {
    const hourStart = Math.floor((Date.now() - 6 * HOUR) / HOUR) * HOUR;
    const at = (m: number) => iso(hourStart + m * MIN);
    await ingest([reading({ measuredAt: at(5), temperatureC: 20, humidityPct: 60 }), reading({ measuredAt: at(35), temperatureC: 30, humidityPct: 80 })]);
    await ingest([reading({ measuredAt: at(20), temperatureC: 25, humidityPct: 70 })]);
    await ingest([reading({ measuredAt: at(20), temperatureC: 25, humidityPct: 70 })]);
    const h = (await (await call(`/api/history?res=hourly&from=${iso(hourStart)}&to=${iso(hourStart + HOUR)}`)).json()) as HistoryResponse;
    expect(h.series[0]!.rows).toEqual([[hourStart, 25, 20, 30, 70, 60, 80, 3]]);
  });
});

describe('histórico', () => {
  it('auto: ≤ 48 h bruto; > 48 h horário; bruto > 48 h recusado; parâmetros inválidos 400', async () => {
    const now = Date.now();
    expect(((await (await call(`/api/history?from=${iso(now - DAY)}&to=${iso(now)}`)).json()) as HistoryResponse).resolution).toBe('raw');
    expect(((await (await call(`/api/history?from=${iso(now - 7 * DAY)}&to=${iso(now)}`)).json()) as HistoryResponse).resolution).toBe('hourly');
    expect((await call(`/api/history?res=raw&from=${iso(now - 7 * DAY)}&to=${iso(now)}`)).status).toBe(400);
    expect((await call(`/api/history?from=xx&to=${iso(now)}`)).status).toBe(400);
    expect((await call(`/api/history?from=${iso(now)}&to=${iso(now - HOUR)}`)).status).toBe(400);
  });
});

describe('configuração', () => {
  const put = (cfg: unknown, token = ADMIN) => call('/api/config', { method: 'PUT', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(cfg) });
  it('grava com controle de revisão (409 em conflito) e valida', async () => {
    const cfg = defaultConfig();
    cfg.sensors[0]!.name = 'Bancada Norte';
    expect((await put(cfg)).status).toBe(200);
    expect((await put(cfg)).status).toBe(409);
    const got = await getConfig(env.DB);
    expect(got.sensors[0]!.name).toBe('Bancada Norte');
    expect((await put({ ...got, sensors: [{ ...got.sensors[0]!, xM: 13 }] })).status).toBe(400);
    expect((await put({ ...got, hack: true })).status).toBe(400);
    expect((await put({ ...defaultConfig() }, 'errado')).status).toBe(401);
    expect((await put(defaultConfig(), ADMIN)).status).toBe(409);
    expect((await call('/api/config', { method: 'PUT', headers: { authorization: `Bearer ${ADMIN}` }, body: JSON.stringify(got) }, { ...env, ADMIN_TOKEN: undefined } as Env)).status).toBe(503);
  });
});

describe('assinatura eWeLink — vetores de teste da documentação oficial', () => {
  it('OAuth: HMAC-SHA256("abc", "ABC_123") = v1+mfNY2ukxswM8sZOTg99srZsVnUVv9DGXeav1096M=', async () => {
    expect(await hmacBase64('abc', 'ABC_123')).toBe('v1+mfNY2ukxswM8sZOTg99srZsVnUVv9DGXeav1096M=');
  });
  it('POST: assinatura do corpo JSON do exemplo de login', async () => {
    const body = JSON.stringify({ email: '1234@gmail.com', password: '12345678', countryCode: '+1' });
    expect(await hmacBase64('OdPuCZ4PkPPi0rVKRVcGmll2NM6vVk0c', body)).toBe('ttZ/gluzqrafvGonjMD20p4//arW6KoZKbo1SOMEzCA=');
  });
});

describe('parseThing (formatos documentados)', () => {
  const now = Date.now();
  it('UIID 1770: valores ×100, bateria e trigTime como instante da medição', () => {
    const d = parseThing(climateThing('a48000aaaa', 'Sensor bancada', { t: 25.58, h: 52.11, battery: 100, trigTime: now - 60_000 }), now)!;
    expect(d).toMatchObject({ kind: 'climate', temperatureC: 25.58, humidityPct: 52.11, batteryPct: 100, measuredAt: now - 60_000, online: true, uiid: 1770 });
  });
  it('SNZB-02WD (UIID 7033): valores diretos em °C e %, sinal e bateria — JSON real publicado por usuário', () => {
    // params reais de um SNZB-02WD (github.com/AlexxIT/SonoffLAN/issues/1612)
    const item = {
      itemType: 1,
      itemData: {
        name: 'Temp bancada',
        deviceid: 'a480069f8a',
        online: true,
        productModel: 'SNZB-02WD',
        extra: { uiid: 7033 },
        params: {
          temperature: '22.8', temperatureF: '73', humidity: '61', trigTime: String(now - 120_000), battery: 100, tempUnit: 0,
          humCorrection: '0', tempCorrection: '0', subDevRssi: -63, parentid: '10022783f5', subDevId: 'ffff20a40138c1a47033', fwVersion: '1.1.0',
        },
      },
    };
    expect(parseThing(item, now)).toMatchObject({ kind: 'climate', temperatureC: 22.8, humidityPct: 61, batteryPct: 100, rssiDbm: -63, measuredAt: now - 120_000, uiid: 7033 });
  });
  it('SNZB-02D (UIID 7014): ×100', () => {
    const d = climateThing('a48000e', 'D', { t: 23.45, h: 70.5, trigTime: now });
    d.itemData.extra.uiid = 7014;
    expect(parseThing(d, now)).toMatchObject({ kind: 'climate', temperatureC: 23.45, humidityPct: 70.5 });
  });
  it('7033 com valor impossível (ex.: formato ×100 inesperado) é descartado, não gravado', () => {
    const item = { itemType: 1, itemData: { deviceid: 'a480069f8b', name: 'X', online: true, extra: { uiid: 7033 }, params: { temperature: '2280', humidity: '6100', trigTime: String(now) } } };
    expect(parseThing(item, now)).toMatchObject({ kind: 'climate', temperatureC: null, humidityPct: null });
  });
  it('liga/desliga de 1 canal e de vários canais', () => {
    expect(parseThing(switchThing('1000aaaa', 'Bomba', { state: 'on' }), now)).toMatchObject({ kind: 'switch', switchState: 'on' });
    const multi = { itemType: 1, itemData: { deviceid: '1000bbbb', name: 'Duplo', online: true, extra: { uiid: 7 }, params: { switches: [{ switch: 'off', outlet: 1 }, { switch: 'on', outlet: 0 }] } } };
    expect(parseThing(multi, now)).toMatchObject({ kind: 'switch', switchState: 'on', switches: ['on', 'off'] });
  });
  it('valores impossíveis, trigTime ausente e UIID não documentado não viram leitura', () => {
    const bad = climateThing('a48000bbbb', 'X', { t: 25, h: 50, trigTime: now });
    bad.itemData.params.humidity = '15000';
    expect(parseThing(bad, now)).toMatchObject({ kind: 'climate', humidityPct: null });
    const noTrig = climateThing('a48000cccc', 'Y', { t: 25, h: 50, trigTime: now });
    delete (noTrig.itemData.params as Record<string, unknown>).trigTime;
    expect(parseThing(noTrig, now)).toMatchObject({ measuredAt: null });
    const unknown = climateThing('a48000dddd', 'Z', { t: 25, h: 50, trigTime: now });
    unknown.itemData.extra.uiid = 9999;
    expect(parseThing(unknown, now)).toMatchObject({ kind: 'unsupported', temperatureC: null });
    expect(parseThing({ itemType: 3, itemData: { deviceid: 'grp' } }, now)).toBeNull();
    expect(parseThing({ itemType: 1, itemData: { deviceid: 'id inválido' } }, now)).toBeNull();
  });
});

describe('eWeLink ponta a ponta (servidor que reproduz a API documentada)', () => {
  const setup = () => {
    const mock = createEwelinkMock({ appId: APP_ID, appSecret: APP_SECRET, region: 'us' });
    vi.stubGlobal('fetch', (input: RequestInfo, init?: RequestInit) => mock.fetch(input, init));
    return mock;
  };
  /** Faz o fluxo completo: autorizar (admin) → página de login → callback com code/region/state. */
  const connect = async (mock: ReturnType<typeof createEwelinkMock>) => {
    const r = await post('/api/ewelink/authorize', {}, ADMIN);
    expect(r.status).toBe(200);
    const { url } = (await r.json()) as { url: string };
    const login = await mock.handle(new Request(url));
    expect(login.status).toBe(302);
    const cb = new URL(login.headers.get('location')!);
    const res = await call(cb.pathname + cb.search);
    expect(res.status).toBe(302);
    return res.headers.get('location');
  };
  const link = async (patch: (c: AppConfig) => void) => {
    const c = await getConfig(env.DB);
    patch(c);
    await saveConfig(env.DB, c, Date.now());
  };

  it('conecta, lista dispositivos, vincula sensores e bomba, grava leituras com o horário da medição', async () => {
    const mock = setup();
    const t0 = Date.now() - 3 * MIN;
    mock.state.devices = [
      climateThing('snzb01', 'Sensor 1', { t: 26.4, h: 71.2, trigTime: t0 }),
      climateThing('snzb02', 'Sensor 2', { t: 25.1, h: 75.0, trigTime: t0 + 1000 }),
      climateThing('snzb03', 'Sensor 3', { t: 24.0, h: 80.5, trigTime: t0 + 2000, battery: 64 }),
      switchThing('bomba01', 'Bomba', { state: 'off' }),
    ];
    expect(await connect(mock)).toBe('/#/dados?ewelink=conectado');
    const devs = (await (await call('/api/devices')).json()) as { devices: ProviderDeviceDto[] };
    expect(devs.devices.map((d) => `${d.deviceId}:${d.kind}`).sort()).toEqual(['bomba01:switch', 'snzb01:climate', 'snzb02:climate', 'snzb03:climate']);

    // Antes de vincular: nenhuma leitura é atribuída a sensor algum.
    expect(Object.values((await live()).latest).every((r) => r === null)).toBe(true);
    await link((c) => {
      c.sensors[0]!.externalId = 'snzb01';
      c.sensors[1]!.externalId = 'snzb02';
      c.sensors[2]!.externalId = 'snzb03';
      c.pump.deviceId = 'bomba01';
    });
    expect(await pollEwelink(env, env.DB, await getConfig(env.DB), Date.now())).toMatchObject({ ran: true, inserted: 3 });
    let l = await live();
    expect(l.latest.s1).toMatchObject({ temperatureC: 26.4, humidityPct: 71.2, source: 'ewelink', timeBasis: 'source' });
    expect(Date.parse(l.latest.s1!.measuredAt)).toBe(t0);
    expect(l.latest.s3!.batteryPct).toBe(64);
    expect(l.pump).toMatchObject({ comm: 'ok', state: 'off', deviceName: 'Bomba' });
    expect(l.links.s1).toMatchObject({ deviceId: 'snzb01', online: true });

    // Mesma leitura consultada de novo (sensor não reportou nada novo): nenhuma escrita.
    expect(await pollEwelink(env, env.DB, await getConfig(env.DB), Date.now())).toMatchObject({ inserted: 0 });

    // Bomba liga: aparece ligada. Sonoff sai do ar: estado desconhecido, nunca "desligada".
    mock.state.devices[3] = switchThing('bomba01', 'Bomba', { state: 'on' });
    await pollEwelink(env, env.DB, await getConfig(env.DB), Date.now());
    expect((await live()).pump).toMatchObject({ comm: 'ok', state: 'on' });
    mock.state.devices[3] = switchThing('bomba01', 'Bomba', { state: 'off', online: false });
    await pollEwelink(env, env.DB, await getConfig(env.DB), Date.now());
    l = await live();
    expect(l.pump).toMatchObject({ comm: 'offline', state: 'unknown' });
    expect(l.integration.ewelink).toMatchObject({ connected: true, region: 'us', consecutiveFailures: 0, lastError: null });
    expect(l.integration.ewelink.callsThisMonth).toBeGreaterThanOrEqual(5);
  });

  it('token expirado: renova automaticamente e continua lendo', async () => {
    const mock = setup();
    mock.state.devices = [climateThing('snzb01', 'S1', { t: 25, h: 70, trigTime: Date.now() - MIN })];
    await connect(mock);
    await link((c) => void (c.sensors[0]!.externalId = 'snzb01'));
    const genBefore = mock.state.gen;
    mock.state.expireNext = true;
    expect(await pollEwelink(env, env.DB, await getConfig(env.DB), Date.now())).toMatchObject({ ran: true, inserted: 1 });
    expect(mock.state.gen).toBe(genBefore + 1);
    expect(mock.state.calls).toContain('POST /v2/user/refresh');
  }, 10_000);

  it('renova preventivamente quando faltam menos de 5 dias para o token vencer', async () => {
    const mock = setup();
    await connect(mock);
    const gen = mock.state.gen;
    await pollEwelink(env, env.DB, await getConfig(env.DB), Date.now() + 26 * DAY);
    expect(mock.state.gen).toBe(gen + 1);
  }, 10_000);

  it('cota esgotada e falhas: registra o erro visível, não apaga dados e não inventa estado', async () => {
    const mock = setup();
    mock.state.devices = [switchThing('bomba01', 'Bomba', { state: 'on' })];
    await connect(mock);
    await link((c) => void (c.pump.deviceId = 'bomba01'));
    await pollEwelink(env, env.DB, await getConfig(env.DB), Date.now());
    mock.state.quota = true;
    const later = Date.now() + 40 * MIN;
    expect(await pollEwelink(env, env.DB, await getConfig(env.DB), later)).toMatchObject({ ran: true, reason: 'quota' });
    const l = await live();
    expect(l.integration.ewelink.lastError?.code).toBe('quota');
    expect(l.integration.ewelink.consecutiveFailures).toBe(1);
    // A última leitura da bomba ficou velha: o painel passa a "sem comunicação" em vez de repetir "ligada".
    vi.useFakeTimers({ now: later, toFake: ['Date'] });
    expect((await live()).pump).toMatchObject({ comm: 'stale', state: 'unknown' });
    vi.useRealTimers();
  });

  it('irrigações: liga → desliga vira um registro com duração; sem sinal não presume que desligou', async () => {
    const mock = setup();
    mock.state.devices = [switchThing('bomba01', 'Bomba', { state: 'off' })];
    await connect(mock);
    await link((c) => void (c.pump.deviceId = 'bomba01'));
    const T0 = Date.now();
    const tick = async (t: number, state: 'on' | 'off', online = true) => {
      mock.state.devices = [switchThing('bomba01', 'Bomba', { state, online })];
      await runScheduled(env, t, { always: true });
    };
    await tick(T0, 'off');
    await tick(T0 + 2 * MIN, 'on');
    await tick(T0 + 4 * MIN, 'on');
    await tick(T0 + 6 * MIN, 'on');
    // Em andamento: aparece com a duração até a última confirmação.
    vi.useFakeTimers({ now: T0 + 6 * MIN, toFake: ['Date'] });
    let l = await live();
    expect(l.irrigations.last[0]).toMatchObject({ startedAt: iso(T0 + 2 * MIN), endedAt: null, durationMs: 4 * MIN });
    vi.useRealTimers();
    await tick(T0 + 8 * MIN, 'off');
    const r = (await (await call(`/api/irrigations?from=${iso(T0 - DAY)}&to=${iso(T0 + DAY)}`)).json()) as { events: { startedAt: string; endedAt: string; durationMs: number; endReason: string }[] };
    expect(r.events).toEqual([{ startedAt: iso(T0 + 2 * MIN), endedAt: iso(T0 + 8 * MIN), lastOnAt: iso(T0 + 6 * MIN), endReason: 'off', durationMs: 6 * MIN }]);

    // Segunda irrigação: o Sonoff some no meio. Antes de 30 min nada é fechado; depois, fecha no último "ligada" visto.
    await tick(T0 + 20 * MIN, 'on');
    await tick(T0 + 22 * MIN, 'on', false);
    await tick(T0 + 40 * MIN, 'on', false);
    let ev = (await (await call(`/api/irrigations?from=${iso(T0 - DAY)}&to=${iso(T0 + DAY)}`)).json()) as { events: { endedAt: string | null; endReason: string | null }[] };
    expect(ev.events[0]).toMatchObject({ endedAt: null, endReason: null });
    await tick(T0 + 55 * MIN, 'on', false);
    ev = (await (await call(`/api/irrigations?from=${iso(T0 - DAY)}&to=${iso(T0 + DAY)}`)).json()) as typeof ev;
    expect(ev.events[0]).toMatchObject({ endedAt: iso(T0 + 20 * MIN), endReason: 'sem_sinal' });

    vi.useFakeTimers({ now: T0 + 60 * MIN, toFake: ['Date'] });
    l = await live();
    expect(l.irrigations.last).toHaveLength(2);
    vi.useRealTimers();
    expect((await call(`/api/irrigations?from=${iso(T0)}&to=${iso(T0 - 1)}`)).status).toBe(400);
  });

  it('automação: liga no horário, configura o Inching, desliga ao passar do tempo e quando as regras proíbem', async () => {
    const mock = setup();
    mock.state.devices = [switchThing('bomba01', 'Bomba', { state: 'off' })];
    await connect(mock);
    const T = Math.floor(Date.now() / MIN) * MIN;
    const slot = localDateTimeString(T).slice(11, 16);
    await link((c) => {
      c.pump.deviceId = 'bomba01';
      c.irrigationRules = { maxTempC: 30, maxSunWm2: null, avoidFrom: null, avoidTo: null };
      c.automation = { ...c.automation, mode: 'automatico', schedule: [slot] };
    });
    // estufa fresca
    await ingest([reading({ sensorId: 's1', temperatureC: 24, measuredAt: iso(T - MIN) })]);

    await runScheduled(env, T, { always: true });
    expect(mock.state.commands[0]).toEqual({ id: 'bomba01', params: { switch: 'on' } });
    vi.useFakeTimers({ now: T + MIN, toFake: ['Date'] });
    let l = await live();
    vi.useRealTimers();
    expect(l.automation).toMatchObject({ mode: 'automatico', ready: true, blockedBy: null });
    expect(l.automation.slots).toEqual([{ time: slot, status: 'feito', detail: 'irrigação iniciada pelo sistema' }]);
    expect(l.automation.lastCommand).toMatchObject({ action: 'on', ok: true, reason: `horário das ${slot}` });
    expect(l.pump.state).toBe('on');

    // próxima rodada: ainda dentro do tempo → só configura o Inching (desliga sozinho em 5 min, no próprio Sonoff)
    await runScheduled(env, T + 4 * MIN, { always: true });
    expect(mock.state.commands[1]).toEqual({ id: 'bomba01', params: { pulse: 'on', pulseWidth: 300_000 } });
    expect(mock.state.commands).toHaveLength(2);

    // passou de 5 min → o servidor desliga (segunda camada)
    await runScheduled(env, T + 6 * MIN, { always: true });
    expect(mock.state.commands[2]).toEqual({ id: 'bomba01', params: { switch: 'off' } });

    // ligada à mão com a estufa quente → desliga pelas regras
    await ingest([reading({ sensorId: 's1', temperatureC: 33, measuredAt: iso(T) })]);
    mock.state.devices[0].itemData.params.switch = 'on';
    await runScheduled(env, T + 10 * MIN, { always: true });
    expect(mock.state.commands[3]).toEqual({ id: 'bomba01', params: { switch: 'off' } });

    const log = (await (await call(`/api/automation/log?from=${iso(T - DAY)}&to=${iso(T + DAY)}`)).json()) as { entries: { action: string; reason: string; ok: boolean }[] };
    expect(log.entries.map((e) => e.action)).toEqual(['off', 'off', 'inching', 'on']);
    expect(log.entries[0]!.reason).toContain('Estufa a 33,0°');
    expect(log.entries[1]!.reason).toBe('passou do tempo de 5 min');
  });

  it('automação: Sonoff fora do ar ao receber o comando → registra a falha e tenta de novo depois', async () => {
    const mock = setup();
    mock.state.devices = [switchThing('bomba01', 'Bomba', { state: 'off' })];
    await connect(mock);
    const T = Math.floor(Date.now() / MIN) * MIN;
    const slot = localDateTimeString(T).slice(11, 16);
    await link((c) => {
      c.pump.deviceId = 'bomba01';
      c.irrigationRules = { maxTempC: null, maxSunWm2: null, avoidFrom: null, avoidTo: null };
      c.automation = { ...c.automation, schedule: [slot], syncInching: false };
    });
    mock.state.failCommands = true;
    await runScheduled(env, T, { always: true });
    vi.useFakeTimers({ now: T + MIN, toFake: ['Date'] });
    let l = await live();
    vi.useRealTimers();
    expect(l.automation.lastCommand).toMatchObject({ action: 'on', ok: false });
    expect(l.automation.slots[0]).toMatchObject({ status: 'adiado' });
    // dentro do intervalo de espera, não insiste
    await runScheduled(env, T + 2 * MIN, { always: true });
    mock.state.failCommands = false;
    await runScheduled(env, T + 4 * MIN, { always: true });
    expect(mock.state.commands).toEqual([{ id: 'bomba01', params: { switch: 'on' } }]);
    vi.useFakeTimers({ now: T + 5 * MIN, toFake: ['Date'] });
    l = await live();
    vi.useRealTimers();
    expect(l.automation.slots[0]).toMatchObject({ status: 'feito' });
  });

  it('automação sem eWeLink conectado: não faz nada e diz o que falta', async () => {
    const l = await live();
    expect(l.automation).toMatchObject({ mode: 'automatico', ready: false, blockedBy: 'Conecte a conta eWeLink' });
    expect((await live({ ...env, EWELINK_APP_ID: undefined } as Env)).automation.blockedBy).toBe('Aguardando a credencial do eWeLink no servidor');
  });

  it('callback com state errado/expirado ou sem conexão iniciada é recusado', async () => {
    setup();
    const bad = await call('/api/ewelink/callback?code=code-12345678&region=us&state=inventado');
    expect(bad.headers.get('location')).toBe('/#/dados?ewelink=erro&motivo=invalid_state');
    await post('/api/ewelink/authorize', {}, ADMIN);
    const wrongRegion = await call('/api/ewelink/callback?code=code-12345678&region=xx&state=inventado');
    expect(wrongRegion.headers.get('location')).toContain('ewelink=erro');
    expect((await live()).integration.ewelink.connected).toBe(false);
  });

  it('tokens ficam cifrados no banco e somem ao desconectar', async () => {
    const mock = setup();
    await connect(mock);
    const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'ewelink_tokens'").first<{ value: string }>();
    expect(row!.value).not.toContain(mock.state.at);
    expect(row!.value).not.toContain(mock.state.rt);
    expect((await post('/api/ewelink/disconnect', {}, ADMIN)).status).toBe(200);
    expect((await live()).integration.ewelink.connected).toBe(false);
  });

  it('sem EWELINK_REDIRECT_URL: usa o endereço do próprio sistema no login e na troca do código', async () => {
    const mock = setup();
    env.EWELINK_REDIRECT_URL = undefined;
    expect(await connect(mock)).toBe('/#/dados?ewelink=conectado');
    expect(mock.state.lastRedirectUrl).toBe('http://localhost/api/ewelink/callback');
    expect((await live()).integration.ewelink.connected).toBe(true);
  });

  it('sem credenciais do app no servidor: não tenta conectar nem ler', async () => {
    const e = { ...env, EWELINK_APP_ID: undefined } as Env;
    expect((await post('/api/ewelink/authorize', {}, ADMIN, e)).status).toBe(503);
    expect(await pollEwelink(e, e.DB, defaultConfig(), Date.now())).toEqual({ ran: false, reason: 'not_configured' });
  });

  it('tarefa agendada roda a leitura', async () => {
    const mock = setup();
    mock.state.devices = [climateThing('snzb01', 'S1', { t: 25, h: 70, trigTime: Date.now() - MIN })];
    await connect(mock);
    await link((c) => void (c.sensors[0]!.externalId = 'snzb01'));
    await runScheduled(env, Date.now(), { always: true });
    expect((await live()).latest.s1?.temperatureC).toBe(25);
  });
});

describe('retenção', () => {
  it('remove leituras brutas antigas e mantém o agregado horário', async () => {
    const now = Date.now();
    const mk = (measuredAt: number) => ({ sensorId: 's1', measuredAt, receivedAt: measuredAt, timeBasis: 'source' as const, temperatureC: 25, humidityPct: 60, batteryPct: null, linkQuality: null, rssiDbm: null, source: 't' });
    await persistReadings(env.DB, [mk(now - 60 * DAY), mk(now - HOUR)]);
    expect((await applyRetention(env.DB, defaultConfig(), now)).rawDeleted).toBe(1);
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM readings_hourly').first<{ n: number }>())!.n).toBe(2);
    expect((await call('/api/admin/maintenance', { method: 'POST' })).status).toBe(401);
  });
});

describe('registro de erros sem segredos', () => {
  it('redact remove Bearer, ?k= e os segredos configurados (inclusive do eWeLink)', () => {
    const out = redact(`Bearer abc.DEF-123 /api/live?k=${VIEW} ${ADMIN} ${APP_SECRET} {"password":"segredo"}`, { VIEW_TOKEN: VIEW, ADMIN_TOKEN: ADMIN, EWELINK_APP_SECRET: APP_SECRET });
    for (const s of ['abc.DEF-123', VIEW, ADMIN, APP_SECRET, 'segredo']) expect(out).not.toContain(s);
  });
  it('erro interno responde 500 genérico com requestId, sem detalhes', async () => {
    const broken = { ...env, DB: { prepare: () => { throw new Error(`boom ${INGEST}`); } } } as unknown as Env;
    const res = await call('/api/config', undefined, broken);
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).toContain('requestId');
    expect(text).not.toContain('boom');
    logError('teste', new Error(`x ${INGEST}`), env);
  });
});

describe('coletor Zigbee2MQTT (origem principal dos sensores)', () => {
  const IEEE1 = '0xa4c138000000aa01';
  const IEEE2 = '0xa4c138000000aa02';
  const collector = (over: Record<string, unknown> = {}) => ({
    version: '1.0.0',
    startedAt: iso(Date.now() - HOUR),
    sentAt: iso(Date.now()),
    mqttConnected: true,
    bridgeOnline: true,
    queued: 0,
    problem: null,
    ...over,
  });
  const device = (ieee: string, name: string, over: Record<string, unknown> = {}) => ({
    ieee,
    name,
    model: 'SNZB-02WD',
    vendor: 'SONOFF',
    climate: true,
    temperatureC: 25,
    humidityPct: 70,
    batteryPct: 100,
    linkQuality: 120,
    lastSeen: iso(Date.now() - MIN),
    ...over,
  });
  const send = (body: unknown, token: string | null = INGEST) => post('/api/v1/ingest/zigbee', body, token);
  const zr = (ieee: string, measuredAt: number, t = 26.1, h = 72.4) => ({ ieee, measuredAt: iso(measuredAt), temperatureC: t, humidityPct: h, batteryPct: 98, linkQuality: 110 });
  const linkS1 = async () => {
    const c = await getConfig(env.DB);
    c.sensors[0]!.externalId = IEEE1;
    await saveConfig(env.DB, c, Date.now());
  };

  it('exige o token de ingestão e recusa campos desconhecidos', async () => {
    expect((await send({ collector: collector() }, null)).status).toBe(401);
    expect((await send({ collector: collector() }, ADMIN)).status).toBe(401);
    expect((await send({ collector: collector(), extra: 1 })).status).toBe(400);
    expect((await send({ collector: collector(), readings: [{ ...zr(IEEE1, Date.now()), ieee: 'abc' }] })).status).toBe(400);
  });

  it('lista os sensores Zigbee para vincular e não grava leitura de sensor não vinculado', async () => {
    const t = Date.now() - 2 * MIN;
    const r = await send({ collector: collector(), devices: [device(IEEE1, 'Orquidário 1'), device(IEEE2, 'Orquidário 2')], readings: [zr(IEEE1, t)] });
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ accepted: 0, unlinked: 1 });
    const devs = (await (await call('/api/devices')).json()) as { devices: ProviderDeviceDto[] };
    expect(devs.devices.map((d) => `${d.provider}:${d.deviceId}:${d.kind}`).sort()).toEqual([`zigbee2mqtt:${IEEE1}:climate`, `zigbee2mqtt:${IEEE2}:climate`]);
    expect(Object.values((await live()).latest).every((x) => x === null)).toBe(true);
  });

  it('vinculado: grava com o horário da medição, ignora reenvio e recusa relógio adiantado', async () => {
    await linkS1();
    const t = Date.now() - 3 * MIN;
    const first = await (await send({ collector: collector(), devices: [device(IEEE1, 'Orquidário 1')], readings: [zr(IEEE1, t), zr(IEEE2, t)] })).json();
    expect(first).toMatchObject({ accepted: 1, unlinked: 1, duplicates: 0 });
    // Reenvio após queda de internet: não duplica.
    expect(await (await send({ collector: collector({ queued: 1 }), readings: [zr(IEEE1, t)] })).json()).toMatchObject({ accepted: 0, duplicates: 1 });
    const bad = await (await send({ collector: collector(), readings: [zr(IEEE1, Date.now() + 10 * MIN)] })).json();
    expect(bad).toMatchObject({ rejected: 1, results: [{ status: 'rejected', reason: 'future_timestamp' }] });

    const l = await live();
    expect(l.latest.s1).toMatchObject({ temperatureC: 26.1, humidityPct: 72.4, measuredAt: iso(t), timeBasis: 'source', batteryPct: 98, linkQuality: 110 });
    expect(l.links.s1).toMatchObject({ deviceId: IEEE1, deviceName: 'Orquidário 1' });
    expect(l.integration.collector).toMatchObject({ version: '1.0.0', mqttConnected: true, bridgeOnline: true, lastReadingAt: iso(t), lastRejected: 1 });
    expect(Math.abs(l.integration.collector!.clockSkewMs)).toBeLessThan(5000);
  });

  it('registra a diferença de relógio do coletor para o painel avisar', async () => {
    await send({ collector: collector({ sentAt: iso(Date.now() - 10 * MIN) }) });
    expect((await live()).integration.collector!.clockSkewMs).toBeLessThan(-9 * MIN);
  });

  it('sem nenhum contato do coletor: status nulo', async () => {
    expect((await live()).integration.collector).toBeNull();
  });
});

describe('SwitchBot (origem dos sensores Outdoor Meter, sem computador no local)', () => {
  const SB_TOKEN = 'sb-token-de-teste';
  const SB_SECRET = 'sb-segredo-de-teste';
  const sbEnv = () => ({ ...env, SWITCHBOT_TOKEN: SB_TOKEN, SWITCHBOT_SECRET: SB_SECRET, SWITCHBOT_API_BASE_OVERRIDE: 'https://mock.switchbot.test' }) as Env;
  const setup = () => {
    const mock = createSwitchbotMock({ token: SB_TOKEN, secret: SB_SECRET });
    vi.stubGlobal('fetch', (input: RequestInfo, init?: RequestInit) => mock.fetch(input, init));
    mock.state.devices = [hubMini(), outdoorMeter('C1A1A1A1A101', 'Orquídeas 1'), outdoorMeter('C1A1A1A1A102', 'Orquídeas 2'), outdoorMeter('C1A1A1A1A103', 'Orquídeas 3')];
    mock.state.status.set('C1A1A1A1A101', { deviceId: 'C1A1A1A1A101', deviceType: 'WoIOSensor', temperature: 26.4, humidity: 71, battery: 100 });
    mock.state.status.set('C1A1A1A1A102', { deviceId: 'C1A1A1A1A102', deviceType: 'WoIOSensor', temperature: 25.1, humidity: 75, battery: 60 });
    mock.state.status.set('C1A1A1A1A103', { deviceId: 'C1A1A1A1A103', deviceType: 'WoIOSensor', temperature: 24.0, humidity: 80, battery: 100 });
    return mock;
  };
  const linkAll = async () => {
    const c = await getConfig(env.DB);
    c.sensors.forEach((s, i) => (s.externalId = `C1A1A1A1A10${i + 1}`));
    await saveConfig(env.DB, c, Date.now());
  };

  it('assinatura igual à do exemplo oficial (Base64 de HMAC-SHA256 de token+t+nonce)', async () => {
    const { createHmac } = await import('node:crypto');
    const expected = createHmac('sha256', 'segredo').update('tok' + '1661927531000' + 'abc-123').digest('base64');
    expect(await switchbotSign('tok', 'segredo', '1661927531000', 'abc-123')).toBe(expected);
  });

  it('sem token/segredo no servidor: não tenta ler', async () => {
    expect(await pollSwitchbot(env, env.DB, defaultConfig(), Date.now())).toEqual({ ran: false, reason: 'not_configured' });
    expect((await live()).integration.switchbot.configured).toBe(false);
  });

  it('lista os sensores para vincular (hub não é sensor) e só lê o status dos vinculados', async () => {
    const mock = setup();
    const e = sbEnv();
    const r = await pollSwitchbot(e, e.DB, await getConfig(e.DB), Date.now(), { force: true });
    expect(r).toMatchObject({ ran: true, devices: 4, inserted: 0 });
    expect(mock.state.calls).toEqual(['GET /v1.1/devices']);
    const devs = (await (await call('/api/devices', undefined, e)).json()) as { devices: ProviderDeviceDto[] };
    expect(devs.devices.filter((d) => d.provider === 'switchbot').map((d) => `${d.deviceId}:${d.kind}:${d.model}`).sort()).toEqual([
      'C1A1A1A1A101:climate:Outdoor Meter (IP65)',
      'C1A1A1A1A102:climate:Outdoor Meter (IP65)',
      'C1A1A1A1A103:climate:Outdoor Meter (IP65)',
      'HUB000000001:unsupported:Hub Mini',
    ]);
  });

  it('vinculados: grava a leitura; valor repetido NÃO vira leitura nova (a API não informa o horário da medição)', async () => {
    const mock = setup();
    const e = sbEnv();
    await pollSwitchbot(e, e.DB, await getConfig(e.DB), Date.now(), { force: true });
    await linkAll();
    const t1 = Date.now();
    expect(await pollSwitchbot(e, e.DB, await getConfig(e.DB), t1)).toMatchObject({ ran: true, inserted: 3 });
    expect(mock.state.calls.filter((c: string) => c.endsWith('/status'))).toHaveLength(3);
    let l = await live(e);
    expect(l.latest.s1).toMatchObject({ temperatureC: 26.4, humidityPct: 71, batteryPct: 100, timeBasis: 'received', source: 'switchbot', measuredAt: iso(t1) });
    expect(l.links.s1).toMatchObject({ provider: 'switchbot', deviceName: 'Orquídeas 1' });

    // 2 min depois, nuvem devolve os mesmos valores (sensor parado ou ambiente estável): nada é renovado.
    expect(await pollSwitchbot(e, e.DB, await getConfig(e.DB), t1 + 2 * MIN)).toMatchObject({ inserted: 0 });
    // S2 mudou: só S2 ganha leitura nova.
    mock.state.status.get('C1A1A1A1A102').temperature = 25.4;
    expect(await pollSwitchbot(e, e.DB, await getConfig(e.DB), t1 + 4 * MIN)).toMatchObject({ inserted: 1 });
    // mesmo relógio das leituras (evita virar o dia UTC no meio do teste)
    vi.useFakeTimers({ now: t1 + 4 * MIN, toFake: ['Date'] });
    l = await live(e);
    vi.useRealTimers();
    expect(l.latest.s1!.measuredAt).toBe(iso(t1));
    expect(l.latest.s2).toMatchObject({ temperatureC: 25.4, measuredAt: iso(t1 + 4 * MIN) });
    expect(l.integration.switchbot).toMatchObject({ configured: true, lastError: null, consecutiveFailures: 0 });
    expect(l.integration.switchbot.callsToday).toBeGreaterThan(0);
  });

  it('sensor ou hub offline: não grava nada daquele sensor, os outros seguem, e a falha aparece', async () => {
    const mock = setup();
    const e = sbEnv();
    await pollSwitchbot(e, e.DB, await getConfig(e.DB), Date.now(), { force: true });
    await linkAll();
    mock.state.status.set('C1A1A1A1A102', { code: 161 });
    mock.state.status.set('C1A1A1A1A103', { code: 171 });
    const r = await pollSwitchbot(e, e.DB, await getConfig(e.DB), Date.now());
    expect(r).toMatchObject({ ran: true, inserted: 1, reason: 'device' });
    const l = await live(e);
    expect(l.latest.s2).toBeNull();
    expect(l.integration.switchbot.lastError!.message).toMatch(/161[\s\S]*Hub SwitchBot offline/);
    const devs = (await (await call('/api/devices', undefined, e)).json()) as { devices: ProviderDeviceDto[] };
    expect(devs.devices.find((d) => d.deviceId === 'C1A1A1A1A102')!.online).toBe(false);
  });

  it('token/segredo errados: falha visível, sem gravar', async () => {
    const mock = setup();
    mock.state.unauthorized = true;
    const e = sbEnv();
    expect(await pollSwitchbot(e, e.DB, await getConfig(e.DB), Date.now(), { force: true })).toEqual({ ran: true, reason: 'auth' });
    expect((await live(e)).integration.switchbot.lastError).toMatchObject({ code: 'auth' });
  });

  it('valores impossíveis são recusados', async () => {
    const mock = setup();
    const e = sbEnv();
    await pollSwitchbot(e, e.DB, await getConfig(e.DB), Date.now(), { force: true });
    await linkAll();
    mock.state.status.get('C1A1A1A1A101').humidity = 140;
    expect(await pollSwitchbot(e, e.DB, await getConfig(e.DB), Date.now())).toMatchObject({ inserted: 2, reason: 'device' });
  });

  it('a tarefa agendada lê SwitchBot e eWeLink de forma independente', async () => {
    const mock = setup();
    const e = sbEnv();
    await linkAll();
    await runScheduled(e, Date.now(), { always: true });
    expect(mock.state.calls).toContain('GET /v1.1/devices');
    expect((await live(e)).integration.switchbot.lastSuccessAt).not.toBeNull();
  });
});

describe('clima da cidade (Open-Meteo)', () => {
  const forecast = {
    current: { time: '2026-10-26T15:00', temperature_2m: 27.4, relative_humidity_2m: 58, precipitation: 0, weather_code: 2, is_day: 1 },
    daily: {
      time: ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01'],
      weather_code: [2, 61, 80, 95, 3, 0, 1],
      temperature_2m_max: [29, 25, 24, 26, 28, 30, 31],
      temperature_2m_min: [17, 18, 17, 18, 16, 17, 18],
      precipitation_sum: [0, 12, 6, 22, 0, 0, 0],
      precipitation_probability_max: [5, 80, 65, 90, 20, 0, 3],
    },
  };
  const weather = async () => (await (await call('/api/weather')).json()) as import('@orq/core').WeatherResponse;

  it('sem cidade: não consulta nada; com cidade: busca, guarda 15 min e, se falhar depois, mostra o guardado como desatualizado', async () => {
    const calls: string[] = [];
    let fail = false;
    vi.stubGlobal('fetch', async (input: RequestInfo) => {
      calls.push(String(input));
      if (fail) return new Response('erro', { status: 500 });
      return new Response(JSON.stringify(forecast), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    await saveConfig(env.DB, { ...defaultConfig(), location: null }, Date.now());
    expect(await weather()).toMatchObject({ configured: false, data: null });
    expect(calls).toHaveLength(0);

    await saveConfig(env.DB, { ...defaultConfig(), revision: 1, location: { name: 'Uberlândia, Minas Gerais', lat: -18.9186, lon: -48.2772 } }, Date.now());
    const w1 = await weather();
    expect(w1).toMatchObject({ configured: true, place: 'Uberlândia, Minas Gerais', stale: false, error: null });
    expect(w1.data!.current.temperatureC).toBe(27.4);
    expect(w1.data!.days).toHaveLength(7);
    expect(calls[0]).toContain('latitude=-18.9186');
    await weather();
    expect(calls).toHaveLength(1); // do cache

    await env.DB.prepare('UPDATE weather_cache SET fetched_at = fetched_at - ?').bind(16 * MIN).run();
    fail = true;
    const w3 = await weather();
    expect(calls).toHaveLength(2);
    expect(w3).toMatchObject({ stale: true });
    expect(w3.data!.current.temperatureC).toBe(27.4);
    expect(w3.error).toContain('500');
  });

  it('busca de cidade exige token de administração', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ results: [{ name: 'Uberlândia', latitude: -18.91, longitude: -48.27, admin1: 'Minas Gerais', country: 'Brasil' }] }), { status: 200 }));
    expect((await call('/api/geocode?q=uberl')).status).toBe(401);
    const r = await call('/api/geocode?q=uberl', { headers: { authorization: `Bearer ${ADMIN}` } });
    expect(r.status).toBe(200);
    expect(((await r.json()) as { places: { label: string }[] }).places[0]!.label).toBe('Uberlândia, Minas Gerais, Brasil');
  });
});

describe('avisos no celular (Web Push)', () => {
  const b64u = (u: Uint8Array) => Buffer.from(u).toString('base64url');
  async function hmac(k: Uint8Array, d: Uint8Array) {
    const key = await crypto.subtle.importKey('raw', k, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    return new Uint8Array(await crypto.subtle.sign('HMAC', key, d));
  }
  const hkdf = async (salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, n: number) => (await hmac(await hmac(salt, ikm), new Uint8Array([...info, 1]))).slice(0, n);
  async function subscriber() {
    const kp = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair;
    const pub = new Uint8Array((await crypto.subtle.exportKey('raw', kp.publicKey)) as ArrayBuffer);
    const auth = crypto.getRandomValues(new Uint8Array(16));
    return { kp, pub, auth };
  }
  async function decrypt(s: Awaited<ReturnType<typeof subscriber>>, body: Uint8Array) {
    const salt = body.slice(0, 16);
    const asPub = body.slice(21, 86);
    const asKey = await crypto.subtle.importKey('raw', asPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
    const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: asKey } as unknown as Parameters<typeof crypto.subtle.deriveBits>[0], s.kp.privateKey, 256));
    const te = new TextEncoder();
    const ikm = await hkdf(s.auth, ecdh, new Uint8Array([...te.encode('WebPush: info\0'), ...s.pub, ...asPub]), 32);
    const cek = await hkdf(salt, ikm, te.encode('Content-Encoding: aes128gcm\0'), 16);
    const nonce = await hkdf(salt, ikm, te.encode('Content-Encoding: nonce\0'), 12);
    const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
    const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, body.slice(86)));
    expect(plain[plain.length - 1]).toBe(2);
    return new TextDecoder().decode(plain.slice(0, -1));
  }

  it('inscreve, envia aviso cifrado (RFC 8291) com VAPID e o celular consegue ler', async () => {
    const s = await subscriber();
    const endpoint = 'https://push.example.test/abc';
    expect((await post('/api/push/subscribe', { endpoint, keys: { p256dh: b64u(s.pub), auth: b64u(s.auth) } }, null)).status).toBe(200);
    const sent: { url: string; headers: Headers; body: Uint8Array }[] = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      sent.push({ url, headers: new Headers(init.headers), body: new Uint8Array(init.body as Uint8Array) });
      return new Response(null, { status: 201 });
    });
    const r = await post('/api/push/test', { endpoint }, null);
    expect(((await r.json()) as { sent: number }).sent).toBe(1);
    expect(sent[0]!.url).toBe(endpoint);
    expect(sent[0]!.headers.get('content-encoding')).toBe('aes128gcm');
    const auth = sent[0]!.headers.get('authorization')!;
    expect(auth).toMatch(/^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=[\w-]+$/);
    // assinatura VAPID confere com a chave pública divulgada
    const { publicKey } = (await (await call('/api/push/key')).json()) as { publicKey: string };
    expect(auth.endsWith(`k=${publicKey}`)).toBe(true);
    const [h, c, sig] = auth.slice(8, auth.indexOf(',')).split('.');
    const pk = await crypto.subtle.importKey('raw', Buffer.from(publicKey, 'base64url'), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    expect(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pk, Buffer.from(sig!, 'base64url'), new TextEncoder().encode(`${h}.${c}`))).toBe(true);
    expect(JSON.parse(Buffer.from(c!, 'base64url').toString()).aud).toBe('https://push.example.test');
    expect(JSON.parse(await decrypt(s, sent[0]!.body))).toMatchObject({ title: 'Orquidário Inteligente', tag: 'teste' });
  });

  it('alerta automático só na mudança; assinatura expirada (410) é removida', async () => {
    const s = await subscriber();
    const endpoint = 'https://push.example.test/xyz';
    await post('/api/push/subscribe', { endpoint, keys: { p256dh: b64u(s.pub), auth: b64u(s.auth) } }, null);
    const c = await getConfig(env.DB);
    c.alerts.temperature = { min: 10, max: 30 };
    await saveConfig(env.DB, c, Date.now());
    const T = Date.now();
    await ingest([reading({ sensorId: 's1', temperatureC: 34, measuredAt: iso(T - MIN) })]);
    const bodies: Uint8Array[] = [];
    let status = 201;
    vi.stubGlobal('fetch', async (_u: string, init: RequestInit) => {
      bodies.push(new Uint8Array(init.body as Uint8Array));
      return new Response(null, { status });
    });
    await runScheduled(env, T, { always: true });
    expect(bodies).toHaveLength(1);
    expect(JSON.parse(await decrypt(s, bodies[0]!)).title).toBe('Estufa quente');
    await runScheduled(env, T + 2 * MIN, { always: true });
    expect(bodies).toHaveLength(1); // não repete
    status = 410;
    await env.DB.prepare("DELETE FROM settings WHERE key = 'push_alerts'").run(); // força novo envio
    await runScheduled(env, T + 4 * MIN, { always: true });
    const left = await env.DB.prepare('SELECT COUNT(*) AS n FROM push_subscriptions').first<{ n: number }>();
    expect(left!.n).toBe(0);
  });
});

describe('bomba compartilhada fora da lista', () => {
  it('consulta o Sonoff pelo ID informado quando a lista não o devolve', async () => {
    const mock = createEwelinkMock({ appId: APP_ID, appSecret: APP_SECRET });
    vi.stubGlobal('fetch', (input: RequestInfo, init?: RequestInit) => mock.fetch(input, init));
    mock.state.devices = [switchThing('luz01', 'Luz', { state: 'off' })];
    mock.state.hidden = [switchThing('1000055189', 'Irrigação Vandas', { state: 'off' })];
    const r = await post('/api/ewelink/authorize', {}, ADMIN);
    const { url } = (await r.json()) as { url: string };
    const login = await mock.handle(new Request(url));
    const cb = new URL(login.headers.get('location')!);
    await call(cb.pathname + cb.search);
    const c = await getConfig(env.DB);
    c.pump.deviceId = '1000055189';
    await saveConfig(env.DB, c, Date.now());
    await pollEwelink(env, env.DB, await getConfig(env.DB), Date.now(), { force: true });
    const row = await env.DB.prepare("SELECT switch_state FROM provider_devices WHERE device_id = '1000055189'").first<{ switch_state: string }>();
    expect(row?.switch_state).toBe('off');
  });
});

describe('economia da cota: leituras espaçadas', () => {
  it('bomba lida a cada 20 min em repouso e uma conferência pouco antes do horário de irrigação; lista de casas do eWeLink é usada', async () => {
    const mock = createEwelinkMock({ appId: APP_ID, appSecret: APP_SECRET });
    vi.stubGlobal('fetch', (input: RequestInfo, init?: RequestInit) => mock.fetch(input, init));
    mock.state.devices = [switchThing('bomba01', 'Bomba', { state: 'off' })];
    // relógio fixo na ligação, para a leitura feita ao conectar cair exatamente em T
    const T = Math.ceil(Date.now() / MIN) * MIN;
    vi.useFakeTimers({ now: T, toFake: ['Date'] });
    const r = await post('/api/ewelink/authorize', {}, ADMIN);
    const { url } = (await r.json()) as { url: string };
    const login = await mock.handle(new Request(url));
    const cb = new URL(login.headers.get('location')!);
    await call(cb.pathname + cb.search);
    vi.useRealTimers();
    const c = await getConfig(env.DB);
    c.pump.deviceId = 'bomba01';
    c.automation = { ...c.automation, schedule: [] };
    await saveConfig(env.DB, c, Date.now());
    const polls = () => mock.state.calls.filter((x: string) => x === 'GET /v2/device/thing').length;
    expect(polls()).toBe(1); // a leitura feita ao conectar
    expect(mock.state.calls).toContain('GET /v2/family');
    await runScheduled(env, T);
    expect(polls()).toBe(1); // 10 min ainda não passaram desde a leitura ao conectar
    await runScheduled(env, T + 2 * MIN);
    await runScheduled(env, T + 4 * MIN);
    await runScheduled(env, T + 18 * MIN);
    expect(polls()).toBe(1); // em repouso: nada de novo antes de 20 min
    await runScheduled(env, T + 20 * MIN);
    expect(polls()).toBe(2);
    expect(mock.state.calls.filter((x: string) => x === 'GET /v2/family')).toHaveLength(1); // casas só descobertas uma vez
    // pouco antes de um horário de irrigação: uma conferência
    const slot = localDateTimeString(T + 24 * MIN).slice(11, 16);
    const c2 = await getConfig(env.DB);
    c2.automation = { ...c2.automation, schedule: [slot], mode: 'protecao' };
    await saveConfig(env.DB, c2, Date.now());
    await runScheduled(env, T + 22 * MIN);
    await runScheduled(env, T + 23 * MIN);
    await runScheduled(env, T + 24 * MIN);
    expect(polls()).toBe(3); // uma conferência antes do horário, nenhuma depois
  });
});
