import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DAY, HOUR, MIN, defaultConfig } from '@orq/core';
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
    const devs = (await (await call('/api/ewelink/devices')).json()) as { devices: ProviderDeviceDto[] };
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
    const later = Date.now() + 15 * MIN;
    expect(await pollEwelink(env, env.DB, await getConfig(env.DB), later)).toMatchObject({ ran: true, reason: 'quota' });
    const l = await live();
    expect(l.integration.ewelink.lastError?.code).toBe('quota');
    expect(l.integration.ewelink.consecutiveFailures).toBe(1);
    // A última leitura da bomba ficou velha: o painel passa a "sem comunicação" em vez de repetir "ligada".
    vi.useFakeTimers({ now: later, toFake: ['Date'] });
    expect((await live()).pump).toMatchObject({ comm: 'stale', state: 'unknown' });
    vi.useRealTimers();
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
    await runScheduled(env, Date.now());
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
