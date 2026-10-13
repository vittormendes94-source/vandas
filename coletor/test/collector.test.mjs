import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { BATCH_MAX, Collector, HEARTBEAT_MS } from '../src/collector.mjs';
import { SensorTracker, checkBridgeConfig, deviceNameFromTopic, messageTime, parseBridgeDevices, parseBridgeState } from '../src/logic.mjs';
import { JsonFile, QUEUE_MAX, ReadingQueue } from '../src/store.mjs';

const IEEE = '0xa4c138000000aa01';
// Formato real de `zigbee2mqtt/bridge/devices` (recortado): coordenador + SNZB-02WD + um botão.
const BRIDGE_DEVICES = [
  { ieee_address: '0x00124b0000000000', type: 'Coordinator', friendly_name: 'Coordinator', definition: null },
  {
    ieee_address: IEEE,
    type: 'EndDevice',
    friendly_name: 'Orquidario 1',
    supported: true,
    definition: {
      model: 'SNZB-02WD',
      vendor: 'SONOFF',
      exposes: [
        { type: 'numeric', name: 'battery', property: 'battery', unit: '%' },
        { type: 'numeric', name: 'temperature', property: 'temperature', unit: '°C' },
        { type: 'numeric', name: 'humidity', property: 'humidity', unit: '%' },
        { type: 'numeric', name: 'linkquality', property: 'linkquality' },
      ],
    },
  },
  {
    ieee_address: '0xa4c138000000bb02',
    type: 'EndDevice',
    friendly_name: 'Botao',
    definition: { model: 'SNZB-01', vendor: 'SONOFF', exposes: [{ type: 'enum', property: 'action' }] },
  },
];
const T0 = Date.parse('2026-10-13T12:00:00.000Z');
const iso = (ms) => new Date(ms).toISOString();

describe('regras puras', () => {
  it('reconhece sensores de temperatura/umidade e ignora coordenador e outros aparelhos', () => {
    const m = parseBridgeDevices(BRIDGE_DEVICES);
    assert.equal(m.size, 2);
    assert.deepEqual(m.get('Orquidario 1'), { ieee: IEEE, name: 'Orquidario 1', model: 'SNZB-02WD', vendor: 'SONOFF', climate: true });
    assert.equal(m.get('Botao').climate, false);
    assert.equal(parseBridgeDevices('x').size, 0);
  });

  it('exposes aninhados também contam', () => {
    const m = parseBridgeDevices([
      { ieee_address: IEEE, type: 'EndDevice', friendly_name: 'x', definition: { exposes: [{ type: 'composite', features: [{ property: 'temperature' }, { property: 'humidity' }] }] } },
    ]);
    assert.equal(m.get('x').climate, true);
  });

  it('estado da ponte em JSON ou texto', () => {
    assert.equal(parseBridgeState('{"state":"online"}'), true);
    assert.equal(parseBridgeState('offline'), false);
    assert.equal(parseBridgeState('???'), null);
  });

  it('exige cache_state desligado e last_seen ligado no Zigbee2MQTT', () => {
    assert.equal(checkBridgeConfig({ config: { advanced: { cache_state: false, last_seen: 'ISO_8601' } } }), null);
    assert.match(checkBridgeConfig({ config: { advanced: { cache_state: true, last_seen: 'ISO_8601' } } }), /cache_state/);
    assert.match(checkBridgeConfig({ config: { advanced: { cache_state: false, last_seen: 'disable' } } }), /last_seen/);
    assert.equal(checkBridgeConfig({}), null);
  });

  it('tópicos: só o estado do aparelho', () => {
    assert.equal(deviceNameFromTopic('zigbee2mqtt', 'zigbee2mqtt/Orquidario 1'), 'Orquidario 1');
    assert.equal(deviceNameFromTopic('zigbee2mqtt', 'zigbee2mqtt/estufa/sensor 2'), 'estufa/sensor 2');
    assert.equal(deviceNameFromTopic('zigbee2mqtt', 'zigbee2mqtt/bridge/devices'), null);
    assert.equal(deviceNameFromTopic('zigbee2mqtt', 'zigbee2mqtt/Orquidario 1/availability'), null);
    assert.equal(deviceNameFromTopic('zigbee2mqtt', 'zigbee2mqtt/Orquidario 1/set'), null);
    assert.equal(deviceNameFromTopic('zigbee2mqtt', 'outro/x'), null);
  });

  it('horário da medição: last_seen (ISO ou epoch); sem ele, a chegada', () => {
    assert.equal(messageTime({ last_seen: iso(T0) }, 1), T0);
    assert.equal(messageTime({ last_seen: T0 }, 1), T0);
    assert.equal(messageTime({ last_seen: 'lixo' }, T0 + 5), T0 + 5);
    assert.equal(messageTime({}, T0 + 5), T0 + 5);
  });
});

describe('SensorTracker (cada mensagem traz só o que o sensor acabou de informar)', () => {
  it('só envia quando já conhece as duas grandezas; depois, cada novidade gera leitura no horário dela', () => {
    const tr = new SensorTracker();
    assert.equal(tr.apply(IEEE, { temperature: 25.4, linkquality: 120, last_seen: iso(T0) }, T0), null); // falta umidade
    assert.deepEqual(tr.apply(IEEE, { humidity: 71.5, last_seen: iso(T0 + 1000) }, T0 + 1000), {
      ieee: IEEE,
      measuredAt: iso(T0 + 1000),
      temperatureC: 25.4,
      humidityPct: 71.5,
      batteryPct: null,
      linkQuality: 120,
    });
    const r = tr.apply(IEEE, { temperature: 25.7, battery: 100, last_seen: iso(T0 + 60_000) }, T0 + 60_000);
    assert.deepEqual([r.measuredAt, r.temperatureC, r.humidityPct, r.batteryPct], [iso(T0 + 60_000), 25.7, 71.5, 100]);
  });

  it('mensagem só de bateria/sinal NÃO vira leitura (não "renova" valor antigo)', () => {
    const tr = new SensorTracker();
    tr.apply(IEEE, { temperature: 25, last_seen: iso(T0) }, T0);
    tr.apply(IEEE, { humidity: 70, last_seen: iso(T0) }, T0);
    assert.equal(tr.apply(IEEE, { battery: 99, voltage: 3000, linkquality: 90, last_seen: iso(T0 + HEARTBEAT_MS) }, T0 + HEARTBEAT_MS), null);
    assert.equal(tr.state.get(IEEE).battery, 99);
  });

  it('valores impossíveis são ignorados', () => {
    const tr = new SensorTracker();
    tr.apply(IEEE, { temperature: 25, humidity: 70, last_seen: iso(T0) }, T0);
    assert.equal(tr.apply(IEEE, { temperature: 300, last_seen: iso(T0 + 1) }, T0 + 1), null);
    assert.equal(tr.apply(IEEE, { humidity: 'x', last_seen: iso(T0 + 2) }, T0 + 2), null);
    assert.equal(tr.state.get(IEEE).t, 25);
  });

  it('mensagem atrasada não sobrescreve valor mais novo', () => {
    const tr = new SensorTracker();
    tr.apply(IEEE, { temperature: 26, humidity: 70, last_seen: iso(T0 + 10_000) }, T0 + 10_000);
    tr.apply(IEEE, { temperature: 20, last_seen: iso(T0) }, T0 + 11_000);
    assert.equal(tr.state.get(IEEE).t, 26);
  });

  it('estado sobrevive a reinício (snapshot)', () => {
    const tr = new SensorTracker();
    tr.apply(IEEE, { temperature: 25, humidity: 70, last_seen: iso(T0) }, T0);
    const tr2 = new SensorTracker(JSON.parse(JSON.stringify(tr.snapshot())));
    assert.equal(tr2.apply(IEEE, { humidity: 72, last_seen: iso(T0 + 1000) }, T0 + 1000).temperatureC, 25);
  });
});

describe('fila em disco', () => {
  let dir;
  beforeEach(() => (dir = mkdtempSync(join(tmpdir(), 'orq-'))));
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('guarda, sobrevive a reinício e remove só o confirmado', () => {
    const q = new ReadingQueue(new JsonFile(dir, 'fila.json'));
    q.push({ a: 1 });
    q.push({ a: 2 });
    q.push({ a: 3 });
    const q2 = new ReadingQueue(new JsonFile(dir, 'fila.json'));
    assert.equal(q2.size, 3);
    q2.drop(2);
    assert.deepEqual(new ReadingQueue(new JsonFile(dir, 'fila.json')).peek(10), [{ a: 3 }]);
  });

  it('limite: descarta as mais antigas e avisa', () => {
    const logs = [];
    const q = new ReadingQueue(new JsonFile(dir, 'fila.json'), (m) => logs.push(m));
    q.items = Array.from({ length: QUEUE_MAX }, (_, i) => ({ i }));
    q.push({ i: 'novo' });
    assert.equal(q.size, QUEUE_MAX);
    assert.equal(q.peek(1)[0].i, 1);
    assert.match(logs[0], /descartada/);
  });
});

describe('Collector (envio ao servidor)', () => {
  let dir;
  let now;
  let calls;
  let respond;
  const make = () =>
    new Collector({
      serverUrl: 'https://orq.test',
      token: 'tok',
      baseTopic: 'zigbee2mqtt',
      dataDir: dir,
      version: '1.0.0',
      now: () => now,
      log: () => {},
      fetch: async (url, init) => {
        calls.push({ url, init, body: JSON.parse(init.body) });
        return respond(calls.at(-1));
      },
    });
  const ok = (body = { accepted: 0, duplicates: 0, unlinked: 0, rejected: 0 }) => new Response(JSON.stringify(body), { status: 200 });
  const feed = (c, at, payload) => c.onMessage('zigbee2mqtt/Orquidario 1', JSON.stringify({ ...payload, last_seen: iso(at) }));
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'orq-'));
    now = T0;
    calls = [];
    respond = () => ok();
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('envia leituras com token, estado do coletor e lista de dispositivos; esvazia a fila após confirmação', async () => {
    const c = make();
    c.setMqttConnected(true);
    c.onMessage('zigbee2mqtt/bridge/state', '{"state":"online"}');
    c.onMessage('zigbee2mqtt/bridge/info', JSON.stringify({ config: { advanced: { cache_state: false, last_seen: 'ISO_8601' } } }));
    c.onMessage('zigbee2mqtt/bridge/devices', JSON.stringify(BRIDGE_DEVICES));
    feed(c, T0, { temperature: 25.1 });
    feed(c, T0 + 2000, { humidity: 70.2, battery: 100, linkquality: 150 });
    c.onMessage('zigbee2mqtt/Botao', JSON.stringify({ action: 'single' })); // não é sensor de clima
    assert.equal(c.queue.size, 1);

    now = T0 + 5000;
    await c.tick();
    assert.equal(calls.length, 1);
    const { url, init, body } = calls[0];
    assert.equal(url, 'https://orq.test/api/v1/ingest/zigbee');
    assert.equal(init.headers.authorization, 'Bearer tok');
    assert.deepEqual(body.collector, {
      version: '1.0.0',
      startedAt: iso(T0),
      sentAt: iso(T0 + 5000),
      mqttConnected: true,
      bridgeOnline: true,
      queued: 0,
      problem: null,
    });
    assert.equal(body.devices.length, 2);
    assert.deepEqual(body.devices.find((d) => d.ieee === IEEE), {
      ieee: IEEE,
      name: 'Orquidario 1',
      model: 'SNZB-02WD',
      vendor: 'SONOFF',
      climate: true,
      temperatureC: 25.1,
      humidityPct: 70.2,
      batteryPct: 100,
      linkQuality: 150,
      lastSeen: iso(T0 + 2000),
    });
    assert.deepEqual(body.readings, [{ ieee: IEEE, measuredAt: iso(T0 + 2000), temperatureC: 25.1, humidityPct: 70.2, batteryPct: 100, linkQuality: 150 }]);
    assert.equal(c.queue.size, 0);

    // Sem novidade e antes do sinal de vida: não envia nada.
    now += 60_000;
    await c.tick();
    assert.equal(calls.length, 1);
    // Sinal de vida a cada 5 min, com a lista de dispositivos.
    now = T0 + 5000 + HEARTBEAT_MS;
    await c.tick();
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[1].body.readings, []);
    assert.ok(calls[1].body.devices);
  });

  it('internet fora: guarda tudo, tenta de novo com espera crescente e envia quando volta', async () => {
    const c = make();
    c.onMessage('zigbee2mqtt/bridge/devices', JSON.stringify(BRIDGE_DEVICES));
    feed(c, T0, { temperature: 25, humidity: 70 });
    respond = () => {
      throw new TypeError('fetch failed');
    };
    await c.tick();
    assert.equal(c.queue.size, 1);
    assert.equal(c.nextTryAt, T0 + 5000);
    now += 1000;
    await c.tick(); // ainda esperando
    assert.equal(calls.length, 1);
    now = c.nextTryAt;
    feed(c, now, { temperature: 25.3 });
    await c.tick();
    assert.equal(c.nextTryAt, now + 10_000);
    assert.equal(c.queue.size, 2);

    // Coletor reinicia sem internet: a fila continua no disco.
    const c2 = make();
    assert.equal(c2.queue.size, 2);
    respond = () => ok();
    await c2.tick();
    assert.equal(calls.at(-1).body.readings.length, 2);
    assert.equal(c2.queue.size, 0);
  });

  it('envia em lotes de até 100', async () => {
    const c = make();
    c.onMessage('zigbee2mqtt/bridge/devices', JSON.stringify(BRIDGE_DEVICES));
    for (let i = 0; i < 150; i++) feed(c, T0 + i * 1000, i % 2 ? { temperature: 25 + i / 100 } : { humidity: 70 });
    const total = c.queue.size;
    await c.tick();
    assert.equal(calls[0].body.readings.length, BATCH_MAX);
    await c.tick();
    assert.equal(calls[1].body.readings.length, total - BATCH_MAX);
    assert.equal(c.queue.size, 0);
  });

  it('token errado (401): não descarta nada', async () => {
    const c = make();
    c.onMessage('zigbee2mqtt/bridge/devices', JSON.stringify(BRIDGE_DEVICES));
    feed(c, T0, { temperature: 25, humidity: 70 });
    respond = () => new Response('{}', { status: 401 });
    await c.tick();
    assert.equal(c.queue.size, 1);
  });

  it('Zigbee2MQTT mal configurado (cache_state ligado): não envia leituras e informa o problema', async () => {
    const c = make();
    c.onMessage('zigbee2mqtt/bridge/info', JSON.stringify({ config: { advanced: { cache_state: true, last_seen: 'ISO_8601' } } }));
    c.onMessage('zigbee2mqtt/bridge/devices', JSON.stringify(BRIDGE_DEVICES));
    feed(c, T0, { temperature: 25, humidity: 70 });
    assert.equal(c.queue.size, 0);
    await c.tick();
    assert.match(calls[0].body.collector.problem, /cache_state/);
  });
});
