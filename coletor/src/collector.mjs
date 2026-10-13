// Coletor: recebe mensagens do Zigbee2MQTT (via MQTT) e envia ao servidor do Orquidário.
// Sem dependência de rede aqui: o MQTT é ligado em index.mjs e o `fetch` é injetado (testável).
import { SensorTracker, checkBridgeConfig, deviceNameFromTopic, devicesPayload, parseBridgeDevices, parseBridgeState } from './logic.mjs';
import { JsonFile, ReadingQueue } from './store.mjs';

export const BATCH_MAX = 100;
export const HEARTBEAT_MS = 5 * 60_000;
const BACKOFF_MAX_MS = 5 * 60_000;

export class Collector {
  /**
   * @param {{ serverUrl: string, token: string, baseTopic: string, dataDir: string, version: string,
   *           fetch?: typeof fetch, now?: () => number, log?: (m: string) => void }} opts
   */
  constructor(opts) {
    this.opts = opts;
    this.fetch = opts.fetch ?? fetch;
    this.now = opts.now ?? Date.now;
    this.log = opts.log ?? ((m) => console.log(`${new Date().toISOString()} ${m}`));
    this.startedAt = this.now();
    this.stateFile = new JsonFile(opts.dataDir, 'sensores.json');
    this.tracker = new SensorTracker(this.stateFile.read({}));
    this.queue = new ReadingQueue(new JsonFile(opts.dataDir, 'fila.json'), this.log);
    this.devices = new Map(); // nome amigável → dispositivo
    this.mqttConnected = false;
    this.bridgeOnline = null;
    this.problem = null;
    this.devicesDirty = true;
    this.lastSentAt = 0;
    this.failures = 0;
    this.nextTryAt = 0;
    this.sending = false;
  }

  setMqttConnected(v) {
    this.mqttConnected = v;
  }

  /** Mensagem MQTT recebida (tópico + texto). */
  onMessage(topic, text) {
    const base = this.opts.baseTopic;
    if (topic === `${base}/bridge/devices`) {
      const parsed = parseBridgeDevices(safeJson(text));
      this.devices = parsed;
      this.devicesDirty = true;
      this.log(`Dispositivos no Zigbee2MQTT: ${parsed.size} (sensores de temperatura/umidade: ${[...parsed.values()].filter((d) => d.climate).length}).`);
      return;
    }
    if (topic === `${base}/bridge/state`) {
      this.bridgeOnline = parseBridgeState(text);
      return;
    }
    if (topic === `${base}/bridge/info`) {
      const info = safeJson(text);
      if (info?.config?.advanced) {
        const problem = checkBridgeConfig(info);
        if (problem !== this.problem && problem) this.log(problem);
        this.problem = problem;
      }
      return;
    }
    const name = deviceNameFromTopic(base, topic);
    if (!name) return;
    const dev = this.devices.get(name);
    if (!dev || !dev.climate) return;
    if (this.problem) return; // configuração do Zigbee2MQTT não garante leitura correta: não envia
    const reading = this.tracker.apply(dev.ieee, safeJson(text), this.now());
    this.stateFile.write(this.tracker.snapshot());
    if (reading) this.queue.push(reading);
  }

  /** Chamado periodicamente (a cada poucos segundos). Envia se houver leitura na fila ou se o sinal de vida venceu. */
  async tick() {
    const now = this.now();
    if (this.sending || now < this.nextTryAt) return;
    const heartbeatDue = now - this.lastSentAt >= HEARTBEAT_MS;
    if (this.queue.size === 0 && !heartbeatDue && !this.devicesDirty) return;
    this.sending = true;
    try {
      await this.sendOnce(heartbeatDue || this.devicesDirty);
    } finally {
      this.sending = false;
    }
  }

  async sendOnce(withDevices) {
    const batch = this.queue.peek(BATCH_MAX);
    const body = {
      collector: {
        version: this.opts.version,
        startedAt: new Date(this.startedAt).toISOString(),
        sentAt: new Date(this.now()).toISOString(),
        mqttConnected: this.mqttConnected,
        bridgeOnline: this.bridgeOnline,
        // Pendentes além deste envio (o servidor só vê o que ainda falta mandar).
        queued: this.queue.size - batch.length,
        problem: this.problem,
      },
      ...(withDevices ? { devices: devicesPayload(this.devices, this.tracker) } : {}),
      readings: batch,
    };
    let res;
    try {
      res = await this.fetch(`${this.opts.serverUrl}/api/v1/ingest/zigbee`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.opts.token}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(20_000),
      });
    } catch (e) {
      return this.fail(`Sem conexão com o servidor (${e?.name === 'TimeoutError' ? 'tempo esgotado' : (e?.message ?? e)}). ${this.queue.size} leitura(s) guardada(s).`);
    }
    if (res.ok) {
      const r = await res.json().catch(() => null);
      this.queue.drop(batch.length);
      if (withDevices) this.devicesDirty = false;
      this.lastSentAt = this.now();
      if (this.failures > 0) this.log('Conexão com o servidor restabelecida.');
      this.failures = 0;
      this.nextTryAt = 0;
      if (r && (r.rejected || r.unlinked)) this.log(`Envio: ${r.accepted} gravada(s), ${r.duplicates} repetida(s), ${r.unlinked} de sensor não vinculado, ${r.rejected} recusada(s).`);
      return;
    }
    const detail = await res.text().catch(() => '');
    if (res.status === 400) {
      // Corpo recusado pela validação do servidor: reenviar não resolve. Descarta este lote e registra o motivo.
      this.queue.drop(batch.length);
      return this.fail(`Servidor recusou o envio (400): ${detail.slice(0, 300)}. ${batch.length} leitura(s) descartada(s).`);
    }
    if (res.status === 401) return this.fail('Servidor recusou o token (401): confira ORQ_INGEST_TOKEN e o INGEST_TOKEN publicado.');
    if (res.status === 503) return this.fail('Servidor sem INGEST_TOKEN configurado (503): publique de novo com o segredo INGEST_TOKEN.');
    return this.fail(`Servidor respondeu ${res.status}. ${this.queue.size} leitura(s) guardada(s).`);
  }

  fail(message) {
    this.failures += 1;
    const wait = Math.min(BACKOFF_MAX_MS, 5_000 * 2 ** Math.min(this.failures - 1, 6));
    this.nextTryAt = this.now() + wait;
    if (this.failures <= 3 || this.failures % 10 === 0) this.log(`${message} Nova tentativa em ${Math.round(wait / 1000)} s.`);
  }
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
