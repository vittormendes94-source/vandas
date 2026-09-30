import { beforeEach, describe, expect, it } from 'vitest';
import { DAY, HOUR, MIN, defaultConfig, generateDemoReadings } from '@orq/core';
import type { HistoryResponse, LiveResponse } from '@orq/core';
import { app } from '../src/app';
import type { Env } from '../src/env';
import { logError, redact } from '../src/logging';
import { applyRetention, getConfig, persistReadings } from '../src/repo';
import { createTestDb } from './d1-shim';

const ADMIN = 'admin-token-de-teste-123';
const INGEST = 'ingest-token-de-teste-456';
const VIEW = 'view-token-de-teste-789';

let env: Env;
beforeEach(() => {
  env = { DB: createTestDb(), ADMIN_TOKEN: ADMIN, INGEST_TOKEN: INGEST } as Env;
});

const call = (path: string, init?: RequestInit, e: Env = env) => app.request(path, init, e);
const post = (path: string, body: unknown, token: string | null = INGEST, e: Env = env) =>
  call(
    path,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    },
    e,
  );
const reading = (over: Record<string, unknown> = {}) => ({ sensorId: 's1', temperatureC: 27.4, humidityPct: 68.2, ...over });
const ingest = (readings: unknown[], token: string | null = INGEST) => post('/api/v1/ingest/readings', { source: 'teste', readings }, token);
const iso = (ms: number) => new Date(ms).toISOString();

describe('autenticação e acesso', () => {
  it('ingestão sem token = 401; token errado = 401; sem INGEST_TOKEN configurado = 503', async () => {
    expect((await ingest([reading()], null)).status).toBe(401);
    expect((await ingest([reading()], 'errado')).status).toBe(401);
    const noIngest = { ...env, INGEST_TOKEN: undefined } as Env;
    expect((await post('/api/v1/ingest/readings', { source: 'x', readings: [reading()] }, INGEST, noIngest)).status).toBe(503);
  });
  it('token de visualização NÃO grava configuração nem ingere', async () => {
    const e = { ...env, VIEW_TOKEN: VIEW } as Env;
    const cfg = defaultConfig('real');
    const put = await call('/api/config?dataset=real', { method: 'PUT', headers: { authorization: `Bearer ${VIEW}` }, body: JSON.stringify(cfg) }, e);
    expect(put.status).toBe(401);
    expect((await post('/api/v1/ingest/readings', { source: 'x', readings: [reading()] }, VIEW, e)).status).toBe(401);
  });
  it('com VIEW_TOKEN, leitura exige token (header ou ?k=); sem ele a API é aberta', async () => {
    const e = { ...env, VIEW_TOKEN: VIEW } as Env;
    expect((await call('/api/live?dataset=real', undefined, e)).status).toBe(401);
    expect((await call('/api/live?dataset=real', { headers: { 'x-view-token': VIEW } }, e)).status).toBe(200);
    expect((await call(`/api/live?dataset=real&k=${VIEW}`, undefined, e)).status).toBe(200);
    expect((await call('/api/live?dataset=real&k=errado', undefined, e)).status).toBe(401);
    // ingest token não serve para ler
    expect((await call('/api/live?dataset=real', { headers: { authorization: `Bearer ${INGEST}` } }, e)).status).toBe(401);
    expect((await call('/api/live?dataset=real')).status).toBe(200);
  });
  it('config: sem ADMIN_TOKEN configurado = 503; token errado = 401', async () => {
    const put = (e: Env, token: string) =>
      call('/api/config?dataset=real', { method: 'PUT', headers: { authorization: `Bearer ${token}` }, body: JSON.stringify(defaultConfig('real')) }, e);
    expect((await put({ ...env, ADMIN_TOKEN: undefined } as Env, ADMIN)).status).toBe(503);
    expect((await put(env, 'errado')).status).toBe(401);
  });
  it('/api/health e /api/meta são abertos e não vazam segredos', async () => {
    const e = { ...env, VIEW_TOKEN: VIEW } as Env;
    expect((await call('/api/health', undefined, e)).status).toBe(200);
    const meta = await call('/api/meta', undefined, e);
    const text = await meta.text();
    expect(text).toContain('"viewProtected":true');
    for (const s of [ADMIN, INGEST, VIEW]) expect(text).not.toContain(s);
  });
});

describe('ingestão de leituras', () => {
  it('aceita, guarda measuredAt e receivedAt separados e serve em /api/live', async () => {
    const measured = Date.now() - 3 * MIN;
    const res = await ingest([reading({ measuredAt: iso(measured), batteryPct: 91, linkQuality: 180 })]);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ accepted: 1, duplicates: 0, rejected: 0 });
    const live = (await (await call('/api/live?dataset=real')).json()) as LiveResponse;
    const r = live.latest.s1!;
    expect(Date.parse(r.measuredAt)).toBe(measured); // instante exato da origem, preservado
    expect(Date.parse(r.receivedAt)).toBeGreaterThan(Date.parse(r.measuredAt));
    expect(r).toMatchObject({ timeBasis: 'source', batteryPct: 91, linkQuality: 180, temperatureC: 27.4 });
    expect(live.latest.s2).toBeNull();
  });
  it('a idade da leitura não é renovada por novas consultas (measuredAt fixo)', async () => {
    await ingest([reading({ measuredAt: iso(Date.now() - 30 * MIN) })]);
    const a = (await (await call('/api/live?dataset=real')).json()) as LiveResponse;
    const b = (await (await call('/api/live?dataset=real')).json()) as LiveResponse;
    expect(b.latest.s1!.measuredAt).toBe(a.latest.s1!.measuredAt);
    expect(Date.parse(b.serverTime)).toBeGreaterThanOrEqual(Date.parse(a.serverTime));
  });
  it('duplicidade é idempotente (mesmo sensor + instante)', async () => {
    const body = [reading({ measuredAt: iso(Date.now() - 5 * MIN) })];
    expect(await (await ingest(body)).json()).toMatchObject({ accepted: 1, duplicates: 0 });
    expect(await (await ingest(body)).json()).toMatchObject({ accepted: 0, duplicates: 1 });
    const h = (await (await call(`/api/history?dataset=real&from=${iso(Date.now() - HOUR)}&to=${iso(Date.now())}`)).json()) as HistoryResponse;
    expect(h.series.find((s) => s.sensorId === 's1')!.rows).toHaveLength(1);
  });
  it('mensagem fora de ordem entra no histórico mas não substitui a leitura mais recente', async () => {
    const newer = Date.now() - 2 * MIN;
    const older = Date.now() - 20 * MIN;
    await ingest([reading({ measuredAt: iso(newer), temperatureC: 30 })]);
    await ingest([reading({ measuredAt: iso(older), temperatureC: 22 })]);
    const live = (await (await call('/api/live?dataset=real')).json()) as LiveResponse;
    expect(live.latest.s1!.temperatureC).toBe(30);
    const h = (await (await call(`/api/history?dataset=real&from=${iso(Date.now() - HOUR)}&to=${iso(Date.now())}`)).json()) as HistoryResponse;
    expect(h.series[0]!.rows.map((r) => r[1])).toEqual([22, 30]); // ordenado por tempo
  });
  it('rejeita sensor desconhecido, timestamp no futuro e muito antigo — sem gravar', async () => {
    const res = (await (
      await ingest([
        reading({ sensorId: 'zz' }),
        reading({ measuredAt: iso(Date.now() + HOUR) }),
        reading({ measuredAt: iso(Date.now() - 200 * DAY) }),
        reading({ measuredAt: iso(Date.now() - MIN) }),
      ])
    ).json()) as { results: { status: string; reason?: string }[] };
    expect(res).toMatchObject({ accepted: 1, rejected: 3 });
    expect(res.results.map((r) => r.reason ?? r.status)).toEqual(['unknown_sensor', 'future_timestamp', 'too_old', 'accepted']);
  });
  it('payload inválido → 400 com detalhes; JSON quebrado → 400; corpo enorme → 413', async () => {
    const bad = await ingest([reading({ temperatureC: 999 })]);
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: { code: string } }).error.code).toBe('invalid_payload');
    expect((await post('/api/v1/ingest/readings', '{nao json')).status).toBe(400);
    expect((await post('/api/v1/ingest/readings', 'x'.repeat(70_000))).status).toBe(413);
  });
  it('a ingestão só escreve em "real"; a demonstração fica separada e o modo real nunca cai para simulados', async () => {
    await ingest([reading({ measuredAt: iso(Date.now() - MIN) })]);
    const real = (await (await call('/api/live?dataset=real')).json()) as LiveResponse;
    expect(real.integration.source).toBe('ingestion-api');
    expect(real.latest.s1).not.toBeNull();
    expect(real.latest.s2).toBeNull();
    expect(real.latest.s3).toBeNull();
    const demo = (await (await call('/api/live?dataset=demo')).json()) as LiveResponse;
    expect(demo.integration.source).toBe('demo-simulator');
    for (const r of Object.values(demo.latest)) if (r) expect(r.source).toBe('demo-simulador');
    // nenhuma leitura simulada apareceu no real
    const h = (await (await call(`/api/history?dataset=real&from=${iso(Date.now() - DAY)}&to=${iso(Date.now())}`)).json()) as HistoryResponse;
    expect(h.series.reduce((n, s) => n + s.rows.length, 0)).toBe(1);
  });
  it('agrega por hora de forma idempotente (média/mín/máx/n) e recalcula com dados fora de ordem', async () => {
    const hourStart = Math.floor((Date.now() - 6 * HOUR) / HOUR) * HOUR;
    const at = (m: number) => iso(hourStart + m * MIN);
    await ingest([reading({ measuredAt: at(5), temperatureC: 20, humidityPct: 60 }), reading({ measuredAt: at(35), temperatureC: 30, humidityPct: 80 })]);
    await ingest([reading({ measuredAt: at(20), temperatureC: 25, humidityPct: 70 })]); // fora de ordem
    await ingest([reading({ measuredAt: at(20), temperatureC: 25, humidityPct: 70 })]); // duplicada
    const h = (await (await call(`/api/history?dataset=real&res=hourly&from=${iso(hourStart)}&to=${iso(hourStart + HOUR)}`)).json()) as HistoryResponse;
    expect(h.resolution).toBe('hourly');
    expect(h.series[0]!.rows).toEqual([[hourStart, 25, 20, 30, 70, 60, 80, 3]]);
  });
});

describe('histórico', () => {
  it('auto: ≤ 48 h bruto; > 48 h horário; bruto acima de 48 h é recusado', async () => {
    const now = Date.now();
    const a = (await (await call(`/api/history?dataset=real&from=${iso(now - DAY)}&to=${iso(now)}`)).json()) as HistoryResponse;
    expect(a.resolution).toBe('raw');
    const b = (await (await call(`/api/history?dataset=real&from=${iso(now - 7 * DAY)}&to=${iso(now)}`)).json()) as HistoryResponse;
    expect(b.resolution).toBe('hourly');
    const c = await call(`/api/history?dataset=real&res=raw&from=${iso(now - 7 * DAY)}&to=${iso(now)}`);
    expect(c.status).toBe(400);
    expect((await call(`/api/history?dataset=real&from=xx&to=${iso(now)}`)).status).toBe(400);
    expect((await call(`/api/history?dataset=real&from=${iso(now)}&to=${iso(now - HOUR)}`)).status).toBe(400);
  });
  it('detail=full traz recebimento, bateria e sinal; períodos sem dados ficam sem linhas', async () => {
    const t = Date.now() - 10 * MIN;
    await ingest([reading({ measuredAt: iso(t), batteryPct: 80, rssiDbm: -70 })]);
    const h = (await (await call(`/api/history?dataset=real&detail=full&from=${iso(t - HOUR)}&to=${iso(Date.now())}`)).json()) as HistoryResponse;
    const [row] = h.series[0]!.rows;
    expect(row![0]).toBe(t);
    expect(row![3]!).toBeGreaterThan(row![0]!);
    expect(row![4]).toBe(80);
    expect(row![6]).toBe(-70);
    expect(h.series[1]!.rows).toEqual([]);
  });
});

describe('relé e períodos de irrigação', () => {
  const relay = (state: string | undefined, measuredAt?: number, extra: object = {}) =>
    post('/api/v1/ingest/relay', { source: 'teste', ...(state ? { state } : {}), ...(measuredAt ? { measuredAt: iso(measuredAt) } : {}), ...extra });
  it('deriva períodos "ligado" observados e sem sinal não vira "desligado"', async () => {
    const now = Date.now();
    await relay('on', now - 50 * MIN);
    await relay('on', now - 49 * MIN); // repetido: não cria transição
    await relay('off', now - 45 * MIN);
    await relay('on', now - 2 * MIN);
    const live = (await (await call('/api/live?dataset=real')).json()) as LiveResponse;
    expect(live.relay).toMatchObject({ comm: 'ok', state: 'on' });
    expect(live.recentIrrigation).toHaveLength(2);
    expect(live.recentIrrigation[1]!.endedAt).toBeNull(); // ainda ligado
    await relay(undefined, undefined, { online: false });
    const lost = (await (await call('/api/live?dataset=real')).json()) as LiveResponse;
    expect(lost.relay).toMatchObject({ comm: 'lost', state: 'unknown', lastKnownState: 'on' });
  });
  it('nunca recebeu dados → no_data', async () => {
    const live = (await (await call('/api/live?dataset=real')).json()) as LiveResponse;
    expect(live.relay).toMatchObject({ comm: 'no_data', state: 'unknown' });
  });
  it('exige state e/ou online', async () => {
    expect((await post('/api/v1/ingest/relay', { source: 'teste' })).status).toBe(400);
    expect((await relay('on', Date.now() + HOUR)).status).toBe(422);
  });
  it('mensagem antiga fora de ordem não muda o último estado', async () => {
    const now = Date.now();
    await relay('on', now - 5 * MIN);
    await relay('off', now - 30 * MIN);
    const live = (await (await call('/api/live?dataset=real')).json()) as LiveResponse;
    expect(live.relay.state).toBe('on');
  });
});

describe('configuração', () => {
  const put = (cfg: unknown, token = ADMIN) =>
    call('/api/config?dataset=real', { method: 'PUT', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(cfg) });
  it('grava com controle de revisão e devolve a nova revisão', async () => {
    const cfg = defaultConfig('real');
    cfg.sensors[0]!.name = 'Bancada Norte';
    cfg.sensors[0]!.xM = 3.25;
    cfg.sensors[0]!.positionProvisional = false;
    const res = await put(cfg);
    expect(res.status).toBe(200);
    const saved = (await res.json()) as { revision: number };
    expect(saved.revision).toBe(1);
    const got = await getConfig(env.DB, 'real');
    expect(got.sensors[0]).toMatchObject({ name: 'Bancada Norte', xM: 3.25, positionProvisional: false });
    // segunda gravação com a revisão antiga → conflito
    expect((await put(cfg)).status).toBe(409);
    // com a revisão nova → ok
    expect((await put({ ...got, freshness: { freshMaxMin: 20, offlineAfterMin: 90 } })).status).toBe(200);
  });
  it('valida limites: sensor fora do orquidário, ids repetidos, campos desconhecidos', async () => {
    const cfg = defaultConfig('real');
    expect((await put({ ...cfg, sensors: [{ ...cfg.sensors[0]!, xM: 13 }] })).status).toBe(400);
    expect((await put({ ...cfg, sensors: [cfg.sensors[0]!, cfg.sensors[0]!] })).status).toBe(400);
    expect((await put({ ...cfg, hack: true })).status).toBe(400);
  });
  it('a configuração de "demo" e de "real" são independentes', async () => {
    const cfg = defaultConfig('real');
    cfg.sensors[0]!.name = 'Só no real';
    await put(cfg);
    expect((await getConfig(env.DB, 'demo')).sensors[0]!.name).toBe('Setor A');
    expect((await getConfig(env.DB, 'real')).sensors[0]!.name).toBe('Só no real');
  });
});

describe('demonstração', () => {
  it('avança o histórico simulado sob demanda (determinístico) e marca a origem como simulada', async () => {
    const live = (await (await call('/api/live?dataset=demo')).json()) as LiveResponse;
    expect(live.dataset).toBe('demo');
    expect(live.config.alerts.demonstrative).toBe(true);
    const h = (await (await call(`/api/history?dataset=demo&from=${iso(Date.now() - 2 * HOUR)}&to=${iso(Date.now())}`)).json()) as HistoryResponse;
    const rows = h.series.flatMap((s) => s.rows);
    expect(rows.length).toBeGreaterThan(10);
    // os valores gravados são exatamente os do simulador determinístico
    const expected = generateDemoReadings(Date.now() - 2 * HOUR, Date.now() - 10_000);
    const byKey = new Map(expected.map((r) => [`${r.sensorId}@${r.measuredAt}`, r]));
    for (const s of h.series) for (const r of s.rows) {
      const e = byKey.get(`${s.sensorId}@${r[0]}`);
      if (e) expect(r[1]).toBe(e.temperatureC);
    }
    const n1 = rows.length;
    await call('/api/live?dataset=demo');
    const h2 = (await (await call(`/api/history?dataset=demo&from=${iso(Date.now() - 2 * HOUR)}&to=${iso(Date.now())}`)).json()) as HistoryResponse;
    expect(h2.series.flatMap((s) => s.rows).length).toBeLessThanOrEqual(n1 + 3); // não duplica
  });
  it('DEMO_ENABLED=false desliga a demonstração e o padrão vira "real"', async () => {
    const e = { ...env, DEMO_ENABLED: 'false' } as Env;
    expect((await call('/api/live?dataset=demo', undefined, e)).status).toBe(404);
    const meta = (await (await call('/api/meta', undefined, e)).json()) as { defaultDataset: string; demoEnabled: boolean };
    expect(meta).toMatchObject({ defaultDataset: 'real', demoEnabled: false });
    expect((await call('/api/live', undefined, e)).status).toBe(200);
  });
  it('dataset inválido → 400', async () => {
    expect((await call('/api/live?dataset=xyz')).status).toBe(400);
  });
});

describe('retenção', () => {
  it('remove leituras brutas antigas e mantém o agregado horário', async () => {
    const now = Date.now();
    const cfg = defaultConfig('real'); // 45 dias
    const old = now - 60 * DAY;
    const mk = (measuredAt: number) => ({
      sensorId: 's1', measuredAt, receivedAt: measuredAt, timeBasis: 'source' as const, temperatureC: 25, humidityPct: 60,
      batteryPct: null, linkQuality: null, rssiDbm: null, source: 't',
    });
    await persistReadings(env.DB, 'real', [mk(old), mk(now - HOUR)]);
    const r = await applyRetention(env.DB, 'real', cfg, now);
    expect(r.rawDeleted).toBe(1);
    const left = await env.DB.prepare("SELECT COUNT(*) AS n FROM readings WHERE dataset='real'").first<{ n: number }>();
    const hourly = await env.DB.prepare("SELECT COUNT(*) AS n FROM readings_hourly WHERE dataset='real'").first<{ n: number }>();
    expect(left!.n).toBe(1);
    expect(hourly!.n).toBe(2); // agregado horário do dado antigo permanece
  });
  it('POST /api/admin/maintenance exige admin', async () => {
    expect((await call('/api/admin/maintenance', { method: 'POST' })).status).toBe(401);
    expect((await call('/api/admin/maintenance', { method: 'POST', headers: { authorization: `Bearer ${ADMIN}` } })).status).toBe(200);
  });
});

describe('registro de erros sem segredos', () => {
  it('redact remove Bearer, ?k= e valores dos tokens configurados', () => {
    const text = `falha Authorization: Bearer abc.DEF-123 em /api/live?k=${VIEW}&x=1 e ${ADMIN} {"password":"segredo"}`;
    const out = redact(text, { VIEW_TOKEN: VIEW, ADMIN_TOKEN: ADMIN });
    for (const s of ['abc.DEF-123', VIEW, ADMIN, 'segredo']) expect(out).not.toContain(s);
    expect(out).toContain('[REDIGIDO]');
  });
  it('erro interno responde 500 genérico, com requestId, sem vazar detalhes', async () => {
    const broken = { ...env, DB: { prepare: () => { throw new Error(`boom com ${INGEST}`); } } } as unknown as Env;
    const res = await call('/api/config?dataset=real', undefined, broken);
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).toContain('requestId');
    expect(text).not.toContain('boom');
    expect(text).not.toContain(INGEST);
    logError('teste', new Error(`x ${INGEST}`), env); // não deve lançar
  });
});
