import { Hono } from 'hono';
import { ZodError } from 'zod';
import { ConfigUpdateSchema, IngestReadingsBodySchema, derivePumpStatus, iso, isoOrNull, prepareReadings, readingToDto } from '@orq/core';
import type { HistoryResponse, LiveResponse, ProviderDeviceDto, ReadingOutcome, SensorLinkDto } from '@orq/core';
import { requireAdmin, requireIngest, requireView } from './auth';
import type { Env } from './env';
import { PROVIDER, buildAuthorizeUrl, disconnect, handleCallback, pollEwelink, statusDto } from './ewelink';
import { HttpError } from './http';
import { logError } from './logging';
import {
  HOURLY_MAX_WINDOW_MS,
  RAW_MAX_WINDOW_MS,
  applyRetention,
  getConfig,
  historyHourly,
  historyRaw,
  latestReadings,
  listProviderDevices,
  persistReadings,
  saveConfig,
} from './repo';

const MAX_BODY_BYTES = 64 * 1024;

export const app = new Hono<{ Bindings: Env }>();

app.use('*', async (c, next) => {
  await next();
  c.header('Cache-Control', 'no-store');
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Referrer-Policy', 'no-referrer');
});

app.onError((err, c) => {
  if (err instanceof HttpError) {
    return c.json({ error: { code: err.code, message: err.message, details: err.details } }, err.status as 400);
  }
  if (err instanceof ZodError) {
    return c.json({ error: { code: 'invalid_payload', message: 'Dados inválidos.', details: err.issues.slice(0, 20).map((i) => ({ path: i.path.join('.'), message: i.message })) } }, 400);
  }
  const requestId = crypto.randomUUID();
  logError('api', err, c.env, { requestId, path: new URL(c.req.url).pathname });
  return c.json({ error: { code: 'internal', message: 'Erro interno. Informe o código ao suporte.', requestId } }, 500);
});

async function readJson(c: { req: { raw: Request } }): Promise<unknown> {
  const text = await c.req.raw.text();
  if (text.length > MAX_BODY_BYTES) throw new HttpError(413, 'payload_too_large', `Corpo maior que ${MAX_BODY_BYTES} bytes.`);
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, 'invalid_json', 'O corpo não é JSON válido.');
  }
}

/* ------------------------------------------------ públicas ------------------------------------------------ */

app.get('/api/health', (c) => c.json({ ok: true, time: iso(Date.now()) }));

/** Informações não sensíveis para o cliente decidir o que mostrar. */
app.get('/api/meta', (c) => c.json({ viewProtected: !!c.env.VIEW_TOKEN, writeAuthConfigured: !!c.env.ADMIN_TOKEN, ingestAuthConfigured: !!c.env.INGEST_TOKEN }));

/* ------------------------------------------------ visualização ------------------------------------------------ */

app.get('/api/live', requireView, async (c) => {
  const now = Date.now();
  const config = await getConfig(c.env.DB);
  const [latest, devices, ewelink] = await Promise.all([
    latestReadings(c.env.DB, config.sensors.map((s) => s.id)),
    listProviderDevices(c.env.DB, PROVIDER),
    statusDto(c.env, c.env.DB, now),
  ]);
  const byId = new Map(devices.map((d) => [d.deviceId, d]));
  const links: Record<string, SensorLinkDto> = {};
  for (const s of config.sensors) {
    const d = s.externalId ? byId.get(s.externalId) : undefined;
    links[s.id] = { deviceId: s.externalId ?? null, deviceName: d?.name ?? null, online: d?.online ?? null, seenAt: isoOrNull(d?.seenAt) };
  }
  const pd = config.pump.deviceId ? byId.get(config.pump.deviceId) : undefined;
  const channel = pd?.switches ? (pd.switches[config.pump.outlet] ?? null) : (pd?.switchState ?? null);
  const pump = derivePumpStatus({ linked: !!config.pump.deviceId, seenAt: pd?.seenAt ?? null, online: pd?.online ?? null, switchState: pd?.kind === 'switch' ? channel : null }, now);
  const body: LiveResponse = {
    serverTime: iso(now),
    config,
    latest: Object.fromEntries([...latest].map(([id, r]) => [id, r ? readingToDto(r) : null])),
    links,
    pump: { comm: pump.comm, state: pump.state, seenAt: isoOrNull(pump.seenAt), deviceName: pd?.name ?? null },
    integration: { ewelink, writeAuthConfigured: !!c.env.ADMIN_TOKEN, ingestAuthConfigured: !!c.env.INGEST_TOKEN },
  };
  return c.json(body);
});

app.get('/api/config', requireView, async (c) => c.json(await getConfig(c.env.DB)));

function parseInstant(v: string | undefined, name: string): number {
  const ms = v ? Date.parse(v) : NaN;
  if (!Number.isFinite(ms)) throw new HttpError(400, 'invalid_range', `Parâmetro "${name}" ausente ou inválido (use ISO 8601).`);
  return ms;
}

/** Histórico. `res=raw|hourly|auto`. Bruto: janela ≤ 48 h (até 3000 leituras por sensor). Horário: até 400 dias. */
app.get('/api/history', requireView, async (c) => {
  const from = parseInstant(c.req.query('from'), 'from');
  const to = parseInstant(c.req.query('to'), 'to');
  if (to <= from) throw new HttpError(400, 'invalid_range', '"to" deve ser posterior a "from".');
  const window = to - from;
  const want = c.req.query('res') ?? 'auto';
  if (!['auto', 'raw', 'hourly'].includes(want)) throw new HttpError(400, 'invalid_resolution', 'res deve ser auto, raw ou hourly.');
  const resolution = want === 'auto' ? (window <= RAW_MAX_WINDOW_MS ? 'raw' : 'hourly') : (want as 'raw' | 'hourly');
  if (resolution === 'raw' && window > RAW_MAX_WINDOW_MS) throw new HttpError(400, 'window_too_large', 'Resolução bruta aceita janelas de até 48 h. Use res=hourly ou divida o período.');
  if (resolution === 'hourly' && window > HOURLY_MAX_WINDOW_MS) throw new HttpError(400, 'window_too_large', 'Janela máxima: 400 dias.');
  const detail = c.req.query('detail') === 'full' ? 'full' : 'basic';
  if (detail === 'full' && resolution !== 'raw') throw new HttpError(400, 'invalid_detail', 'detail=full exige res=raw.');

  const config = await getConfig(c.env.DB);
  const ids = config.sensors.map((s) => s.id);
  const h = resolution === 'raw' ? await historyRaw(c.env.DB, ids, from, to, detail === 'full') : await historyHourly(c.env.DB, ids, from, to);
  const body: HistoryResponse = { from: iso(from), to: iso(to), resolution, detail, series: h.series, truncated: h.truncated };
  return c.json(body);
});

/** Dispositivos encontrados na conta eWeLink na última leitura (para vincular sensores e bomba). */
app.get('/api/ewelink/devices', requireView, async (c) => {
  const devices = await listProviderDevices(c.env.DB, PROVIDER);
  const out: ProviderDeviceDto[] = devices.map((d) => ({
    deviceId: d.deviceId,
    name: d.name,
    uiid: d.uiid,
    model: d.model,
    online: d.online,
    kind: d.kind,
    temperatureC: d.temperatureC,
    humidityPct: d.humidityPct,
    switchState: d.switchState,
    measuredAt: isoOrNull(d.measuredAt),
    seenAt: iso(d.seenAt),
  }));
  return c.json({ devices: out });
});

/* ------------------------------------------------ administração ------------------------------------------------ */

app.put('/api/config', requireAdmin, async (c) => {
  const parsed = ConfigUpdateSchema.parse(await readJson(c));
  return c.json(await saveConfig(c.env.DB, parsed, Date.now()));
});

app.post('/api/admin/maintenance', requireAdmin, async (c) => {
  const now = Date.now();
  return c.json({ ok: true, retention: await applyRetention(c.env.DB, await getConfig(c.env.DB), now) });
});

/** Inicia a conexão com a conta eWeLink: devolve o endereço da página oficial de login. */
app.post('/api/ewelink/authorize', requireAdmin, async (c) => c.json({ url: await buildAuthorizeUrl(c.env, c.env.DB, Date.now()) }));

/** Retorno da página oficial de login do eWeLink (protegido pelo `state` de uso único). */
app.get('/api/ewelink/callback', async (c) => {
  const now = Date.now();
  try {
    await handleCallback(c.env, c.env.DB, { code: c.req.query('code'), region: c.req.query('region'), state: c.req.query('state') }, now);
    await pollEwelink(c.env, c.env.DB, await getConfig(c.env.DB), Date.now(), { force: true });
    return c.redirect('/#/dados?ewelink=conectado', 302);
  } catch (e) {
    const code = e instanceof HttpError ? e.code : 'internal';
    if (!(e instanceof HttpError)) logError('ewelink_callback', e, c.env);
    return c.redirect(`/#/dados?ewelink=erro&motivo=${encodeURIComponent(code)}`, 302);
  }
});

/** Lê o eWeLink agora (além da leitura automática). */
app.post('/api/ewelink/poll', requireAdmin, async (c) => c.json(await pollEwelink(c.env, c.env.DB, await getConfig(c.env.DB), Date.now(), { force: true })));

app.post('/api/ewelink/disconnect', requireAdmin, async (c) => {
  await disconnect(c.env.DB, Date.now());
  return c.json({ ok: true });
});

/* ------------------------------------------------ ingestão genérica ------------------------------------------------ */

/**
 * Leituras de outras origens (ESP32, scripts). Mesma validação e gravação idempotente usadas pelo eWeLink.
 * Aceita mensagens fora de ordem; repetição (mesmo sensor + instante) é ignorada.
 */
app.post('/api/v1/ingest/readings', requireIngest, async (c) => {
  const body = IngestReadingsBodySchema.parse(await readJson(c));
  const now = Date.now();
  const config = await getConfig(c.env.DB);
  const { prepared, rejected } = prepareReadings(body, new Set(config.sensors.map((s) => s.id)), now, config.retention.rawDays);
  const inserted = await persistReadings(c.env.DB, prepared.map((p) => p.reading));
  const results: ReadingOutcome[] = [...rejected];
  prepared.forEach((p, i) => results.push(inserted[i] ? { index: p.index, status: 'accepted' } : { index: p.index, status: 'duplicate' }));
  results.sort((a, b) => a.index - b.index);
  const count = (s: string) => results.filter((r) => r.status === s).length;
  return c.json({ accepted: count('accepted'), duplicates: count('duplicate'), rejected: count('rejected'), results });
});

/* ------------------------------------------------ demais rotas ------------------------------------------------ */

app.all('/api/*', () => {
  throw new HttpError(404, 'not_found', 'Rota inexistente.');
});

app.all('*', async (c) => {
  if (c.env.ASSETS) return c.env.ASSETS.fetch(c.req.raw as unknown as Request) as unknown as Response;
  return c.text('Não encontrado', 404);
});
