// Servidor que REPRODUZ os formatos documentados da API eWeLink v2 (OAuth2.0.md / APICenterV2.md / UIIDProtocol.md).
// Usado apenas em testes automatizados e no teste local ponta a ponta. Não é o eWeLink real.
// Ele VERIFICA as assinaturas (HMAC-SHA256) e os cabeçalhos exigidos, então um erro no cliente faz o teste falhar.
import { createHmac, randomBytes } from 'node:crypto';

const sign = (secret, msg) => createHmac('sha256', secret).update(Buffer.from(msg, 'utf8')).digest('base64');

export function createEwelinkMock({ appId, appSecret, region = 'us' }) {
  const s = {
    appId,
    appSecret,
    region,
    codes: new Set(),
    at: null,
    rt: null,
    gen: 0,
    calls: [],
    /** Força a próxima listagem a responder "token expirado" (402). */
    expireNext: false,
    /** Simula cota mensal esgotada (HTTP 403). */
    quota: false,
    devices: [],
  };

  const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });
  const err = (code, msg) => json({ error: code, msg, data: {} });
  const issue = () => {
    s.gen += 1;
    s.at = `at-${s.gen}-${randomBytes(6).toString('hex')}`;
    s.rt = `rt-${s.gen}-${randomBytes(6).toString('hex')}`;
  };

  async function handle(request) {
    const url = new URL(request.url);
    const body = request.method === 'POST' ? await request.text() : '';
    s.calls.push(`${request.method} ${url.pathname}`);
    if (s.quota) return new Response('quota', { status: 403 });

    // Página oficial de login (c2ccdn.coolkit.cc/oauth/index.html) — simulada: aprova e redireciona.
    if (url.pathname === '/oauth/index.html') {
      const q = url.searchParams;
      if (q.get('clientId') !== s.appId) return new Response('clientId inválido', { status: 400 });
      if (q.get('authorization') !== sign(s.appSecret, `${q.get('clientId')}_${q.get('seq')}`)) return new Response('assinatura inválida', { status: 400 });
      if (!/^[A-Za-z0-9]{8}$/.test(q.get('nonce') ?? '') || q.get('grantType') !== 'authorization_code') return new Response('parâmetros inválidos', { status: 400 });
      const code = `code-${randomBytes(8).toString('hex')}`;
      s.codes.add(code);
      const dest = new URL(q.get('redirectUrl'));
      dest.searchParams.set('code', code);
      dest.searchParams.set('region', s.region);
      dest.searchParams.set('state', q.get('state'));
      return new Response(null, { status: 302, headers: { location: dest.toString() } });
    }

    if (request.headers.get('x-ck-appid') !== s.appId) return err(407, 'appid has no permission');
    if (!/^[A-Za-z0-9]{8}$/.test(request.headers.get('x-ck-nonce') ?? '')) return err(400, 'nonce');
    const auth = request.headers.get('authorization') ?? '';

    if (url.pathname === '/v2/user/oauth/token' && request.method === 'POST') {
      if (request.headers.get('content-type') !== 'application/json') return err(400, 'content-type');
      if (auth !== `Sign ${sign(s.appSecret, body)}`) return err(401, 'sign error');
      const b = JSON.parse(body);
      if (b.grantType !== 'authorization_code' || !s.codes.has(b.code)) return err(405, 'invalid code');
      s.codes.delete(b.code);
      issue();
      const now = Date.now();
      return json({ error: 0, msg: '', data: { accessToken: s.at, atExpiredTime: now + 30 * 86400000, refreshToken: s.rt, rtExpiredTime: now + 60 * 86400000 } });
    }

    if (url.pathname === '/v2/user/refresh' && request.method === 'POST') {
      if (auth !== `Sign ${sign(s.appSecret, body)}`) return err(401, 'sign error');
      if (JSON.parse(body).rt !== s.rt) return err(401, 'invalid rt');
      issue();
      return json({ error: 0, msg: '', data: { at: s.at, rt: s.rt } });
    }

    if (url.pathname === '/v2/device/thing' && request.method === 'GET') {
      if (auth !== `Bearer ${s.at}`) return err(401, 'token invalid');
      if (s.expireNext) {
        s.expireNext = false;
        return err(402, 'access token expired');
      }
      return json({ error: 0, msg: '', data: { thingList: s.devices, total: s.devices.length } });
    }
    return err(403, 'api not found');
  }

  return { state: s, handle, fetch: (input, init) => handle(input instanceof Request ? input : new Request(input, init)) };
}

/** Sensor Zigbee de temperatura/umidade no formato documentado (UIID 1770). */
export function climateThing(deviceid, name, { t, h, battery = 90, trigTime, online = true }) {
  return {
    itemType: 1,
    index: 0,
    itemData: {
      name,
      deviceid,
      online,
      productModel: 'SNZB-02',
      extra: { uiid: 1770, model: 'ZIGBEE_TEMPERATURE_AND_HUMIDITY_SENSOR' },
      params: { temperature: String(Math.round(t * 100)), humidity: String(Math.round(h * 100)), battery, trigTime: String(trigTime) },
    },
  };
}

/** Sonoff de 1 canal (UIID 1/6) no formato documentado. */
export function switchThing(deviceid, name, { state, online = true, uiid = 1 }) {
  return { itemType: 1, index: 1, itemData: { name, deviceid, online, productModel: 'BASICR2', extra: { uiid }, params: { switch: state, startup: 'off' } } };
}
