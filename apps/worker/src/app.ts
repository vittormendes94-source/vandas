import { Hono } from 'hono';
import { ZodError } from 'zod';
import {
  ConfigUpdateSchema,
  DAY,
  IngestReadingsBodySchema,
  IngestRelayBodySchema,
  FUTURE_TOLERANCE_MS,
  deriveRelayStatus,
  iso,
  periodToDto,
  prepareReadings,
  readingToDto,
} from '@orq/core';
import type { Dataset, HistoryResponse, IntegrationInfo, LiveResponse, ReadingOutcome } from '@orq/core';
import { requireAdmin, requireIngest, requireView } from './auth';
import { topUpDemo } from './demo';
import type { Env } from './env';
import { HttpError, demoEnabled, resolveDataset } from './http';
import { ewelinkAdapter } from './integrations';
import { logError } from './logging';
import {
  HOURLY_MAX_WINDOW_MS,
  RAW_MAX_WINDOW_MS,
  applyRetention,
  getConfig,
  getRelayStatus,
  historyHourly,
  historyRaw,
  irrigationPeriods,
  latestReadings,
  persistReadings,
  recordRelay,
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
    return c.json({ error: { code: 'invalid_payload', message: 'Dados inválidos.', details: zodIssues(err) } }, 400);
  }
  const requestId = crypto.randomUUID();
  logError('api', err, c.env, { requestId, path: new URL(c.req.url).pathname });
  return c.json({ error: { code: 'internal', message: 'Erro interno. Informe o código ao suporte.', requestId } }, 500);
});

function zodIssues(err: ZodError) {
  return err.issues.slice(0, 20).map((i) => ({ path: i.path.join('.'), message: i.message }));
}

async function readJson(c: { req: { raw: Request } }): Promise<unknown> {
  const text = await c.req.raw.text();
  if (text.length > MAX_BODY_BYTES) throw new HttpError(413, 'payload_too_large', `Corpo maior que ${MAX_BODY_BYTES} bytes.`);
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, 'invalid_json', 'O corpo não é JSON válido.');
  }
}

function integrationInfo(env: Env, dataset: Dataset): IntegrationInfo {
  const e = ewelinkAdapter.status(env);
  return {
    source: dataset === 'demo' ? 'demo-simulator' : 'ingestion-api',
    demoEnabled: demoEnabled(env),
    ewelink: { state: e.state === 'active' ? 'pending_validation' : e.state, note: e.note },
    writeAuthConfigured: !!env.ADMIN_TOKEN,
    ingestAuthConfigured: !!env.INGEST_TOKEN,
  };
}

/* ------------------------------------------------ públicas ------------------------------------------------ */

app.get('/api/health', (c) => c.json({ ok: true, time: iso(Date.now()) }));

/** Informações não sensíveis para o cliente decidir o que mostrar. */
app.get('/api/meta', (c) =>
  c.json({
    demoEnabled: demoEnabled(c.env),
    defaultDataset: resolveDataset(c.env, undefined),
    viewProtected: !!c.env.VIEW_TOKEN,
    writeAuthConfigured: !!c.env.ADMIN_TOKEN,
    ingestAuthConfigured: !!c.env.INGEST_TOKEN,
  }),
);

/* ------------------------------------------------ visualização ------------------------------------------------ */

app.get('/api/live', requireView, async (c) => {
  const dataset = resolveDataset(c.env, c.req.query('dataset'));
  const now = Date.now();
  if (dataset === 'demo') await topUpDemo(c.env.DB, now);
  const config = await getConfig(c.env.DB, dataset);
  const [latest, relayRow, periods] = await Promise.all([
    latestReadings(c.env.DB, dataset, config.sensors.map((s) => s.id)),
    getRelayStatus(c.env.DB, dataset),
    irrigationPeriods(c.env.DB, dataset, now - DAY, now),
  ]);
  const relay = deriveRelayStatus(relayRow, now, config.irrigation.relayFreshMaxMin);
  const body: LiveResponse = {
    dataset,
    serverTime: iso(now),
    config,
    latest: Object.fromEntries([...latest].map(([id, r]) => [id, r ? readingToDto(r) : null])),
    relay: {
      comm: relay.comm,
      state: relay.state,
      lastKnownState: relay.lastKnownState,
      lastSeenAt: relay.lastSeenAt === null ? null : iso(relay.lastSeenAt),
      lastStateAt: relay.lastStateAt === null ? null : iso(relay.lastStateAt),
    },
    recentIrrigation: periods.map(periodToDto),
    integration: integrationInfo(c.env, dataset),
  };
  return c.json(body);
});

app.get('/api/config', requireView, async (c) => {
  const dataset = resolveDataset(c.env, c.req.query('dataset'));
  return c.json(await getConfig(c.env.DB, dataset));
});

function parseInstant(v: string | undefined, name: string): number {
  const ms = v ? Date.parse(v) : NaN;
  if (!Number.isFinite(ms)) throw new HttpError(400, 'invalid_range', `Parâmetro "${name}" ausente ou inválido (use ISO 8601).`);
  return ms;
}

/**
 * Histórico. `res=raw|hourly|auto`. Bruto: janela ≤ 48 h (até 3000 leituras por sensor). Horário: até 400 dias.
 * `detail=full` (só bruto) inclui recebimento, bateria e sinal — usado na exportação CSV e nas comparações.
 */
app.get('/api/history', requireView, async (c) => {
  const dataset = resolveDataset(c.env, c.req.query('dataset'));
  const from = parseInstant(c.req.query('from'), 'from');
  const to = parseInstant(c.req.query('to'), 'to');
  if (to <= from) throw new HttpError(400, 'invalid_range', '"to" deve ser posterior a "from".');
  const window = to - from;
  const want = c.req.query('res') ?? 'auto';
  if (!['auto', 'raw', 'hourly'].includes(want)) throw new HttpError(400, 'invalid_resolution', 'res deve ser auto, raw ou hourly.');
  const resolution = want === 'auto' ? (window <= RAW_MAX_WINDOW_MS ? 'raw' : 'hourly') : (want as 'raw' | 'hourly');
  if (resolution === 'raw' && window > RAW_MAX_WINDOW_MS) {
    throw new HttpError(400, 'window_too_large', 'Resolução bruta aceita janelas de até 48 h. Use res=hourly ou divida o período.');
  }
  if (resolution === 'hourly' && window > HOURLY_MAX_WINDOW_MS) throw new HttpError(400, 'window_too_large', 'Janela máxima: 400 dias.');
  const detail = c.req.query('detail') === 'full' ? 'full' : 'basic';
  if (detail === 'full' && resolution !== 'raw') throw new HttpError(400, 'invalid_detail', 'detail=full exige res=raw.');

  const now = Date.now();
  if (dataset === 'demo') await topUpDemo(c.env.DB, now);
  const config = await getConfig(c.env.DB, dataset);
  const ids = config.sensors.map((s) => s.id);
  const [h, periods] = await Promise.all([
    resolution === 'raw' ? historyRaw(c.env.DB, dataset, ids, from, to, detail === 'full') : historyHourly(c.env.DB, dataset, ids, from, to),
    irrigationPeriods(c.env.DB, dataset, from, to),
  ]);
  const body: HistoryResponse = {
    dataset,
    from: iso(from),
    to: iso(to),
    resolution,
    detail,
    series: h.series,
    irrigation: periods.map(periodToDto),
    truncated: h.truncated,
  };
  return c.json(body);
});

/* ------------------------------------------------ configuração (admin) ------------------------------------------------ */

app.put('/api/config', requireAdmin, async (c) => {
  const dataset = resolveDataset(c.env, c.req.query('dataset'));
  const parsed = ConfigUpdateSchema.parse(await readJson(c));
  return c.json(await saveConfig(c.env.DB, dataset, parsed, Date.now()));
});

/** Manutenção manual (o cron faz o mesmo diariamente): aplica a retenção. */
app.post('/api/admin/maintenance', requireAdmin, async (c) => {
  const now = Date.now();
  const out: Record<string, unknown> = {};
  for (const ds of (demoEnabled(c.env) ? ['demo', 'real'] : ['real']) as Dataset[]) {
    out[ds] = await applyRetention(c.env.DB, ds, await getConfig(c.env.DB, ds), now);
  }
  return c.json({ ok: true, retention: out });
});

/* ------------------------------------------------ ingestão (dados REAIS) ------------------------------------------------ */

/**
 * Ingestão de leituras — grava SEMPRE no dataset "real" (a demonstração nunca recebe dados por aqui).
 * Idempotente por (sensor, instante da medição). Aceita mensagens fora de ordem.
 */
app.post('/api/v1/ingest/readings', requireIngest, async (c) => {
  const body = IngestReadingsBodySchema.parse(await readJson(c));
  const now = Date.now();
  const config = await getConfig(c.env.DB, 'real');
  const known = new Set(config.sensors.map((s) => s.id));
  const { prepared, rejected } = prepareReadings(body, known, now, config.retention.rawDays);
  const inserted = await persistReadings(c.env.DB, 'real', prepared.map((p) => p.reading));

  const results: ReadingOutcome[] = [...rejected];
  prepared.forEach((p, i) => results.push(inserted[i] ? { index: p.index, status: 'accepted' } : { index: p.index, status: 'duplicate' }));
  results.sort((a, b) => a.index - b.index);
  const count = (s: string) => results.filter((r) => r.status === s).length;
  return c.json({ accepted: count('accepted'), duplicates: count('duplicate'), rejected: count('rejected'), results });
});

/** Estado do relé (Sonoff). Informa o estado reportado pelo controlador; não confirma passagem de água. */
app.post('/api/v1/ingest/relay', requireIngest, async (c) => {
  const body = IngestRelayBodySchema.parse(await readJson(c));
  if (body.state === undefined && body.online === undefined) {
    throw new HttpError(400, 'invalid_payload', 'Informe "state" e/ou "online".');
  }
  const now = Date.now();
  const changedAt = body.measuredAt ? Date.parse(body.measuredAt) : now;
  if (changedAt > now + FUTURE_TOLERANCE_MS) throw new HttpError(422, 'future_timestamp', 'measuredAt está no futuro.');
  const r = await recordRelay(c.env.DB, 'real', {
    deviceId: body.deviceId,
    state: body.state,
    changedAt,
    receivedAt: now,
    online: body.online,
    source: body.source,
  });
  return c.json({ ok: true, transitionStored: r.transitionStored });
});

/* ------------------------------------------------ demais rotas ------------------------------------------------ */

app.all('/api/*', () => {
  throw new HttpError(404, 'not_found', 'Rota inexistente.');
});

// Fora de /api: entrega arquivos estáticos (em produção o Assets já responde antes de chegar aqui).
app.all('*', async (c) => {
  if (c.env.ASSETS) return c.env.ASSETS.fetch(c.req.raw as unknown as Request) as unknown as Response;
  return c.text('Não encontrado', 404);
});
