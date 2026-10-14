// Servidor de testes que reproduz a API oficial SwitchBot v1.1 (formatos do README oficial) e CONFERE a assinatura
// exatamente como o exemplo oficial em JavaScript: crypto.createHmac('sha256', secret).update(token + t + nonce).digest('base64').
import { createHmac } from 'node:crypto';

export function createSwitchbotMock({ token, secret }) {
  const state = {
    calls: [],
    devices: [], // itens de deviceList
    status: new Map(), // deviceId → body | { code }
    unauthorized: false,
  };
  const json = (b, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
  async function handle(request) {
    const url = new URL(request.url);
    state.calls.push(`${request.method} ${url.pathname}`);
    const h = request.headers;
    const expected = createHmac('sha256', secret).update(`${h.get('authorization')}${h.get('t')}${h.get('nonce')}`).digest('base64');
    if (state.unauthorized || h.get('authorization') !== token || h.get('sign') !== expected || !/^\d{13}$/.test(h.get('t') ?? '') || !h.get('nonce'))
      return json({ message: 'Unauthorized' }, 401);
    if (url.pathname === '/v1.1/devices') return json({ statusCode: 100, body: { deviceList: state.devices, infraredRemoteList: [] }, message: 'success' });
    const m = url.pathname.match(/^\/v1\.1\/devices\/([^/]+)\/status$/);
    if (m) {
      const st = state.status.get(decodeURIComponent(m[1]));
      if (!st) return json({ statusCode: 152, body: {}, message: 'device not found' });
      if (st.code) return json({ statusCode: st.code, body: {}, message: 'error' });
      return json({ statusCode: 100, body: st, message: 'success' });
    }
    return json({ message: 'not found' }, 404);
  }
  return { state, fetch: (input, init) => handle(input instanceof Request ? input : new Request(input, init)) };
}

export const outdoorMeter = (id, name, { cloud = true } = {}) => ({ deviceId: id, deviceName: name, deviceType: 'WoIOSensor', enableCloudService: cloud, hubDeviceId: 'HUB000000001' });
export const hubMini = () => ({ deviceId: 'HUB000000001', deviceName: 'Hub Mini', deviceType: 'Hub Mini', enableCloudService: true, hubDeviceId: '000000000000' });
