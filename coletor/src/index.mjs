// Ponto de entrada do coletor: liga o MQTT (Mosquitto local, onde o Zigbee2MQTT publica) ao Collector.
// Configuração por variáveis de ambiente (arquivo .env gerado pelo instalador).
import { readFileSync } from 'node:fs';
import mqtt from 'mqtt';
import { Collector } from './collector.mjs';

const env = (name, fallback) => {
  const v = process.env[name] ?? fallback;
  if (v === undefined || v === '') {
    console.error(`Variável ${name} não definida. Rode o instalador de novo (coletor/instalar.sh).`);
    process.exit(1);
  }
  return v;
};

const serverUrl = env('ORQ_URL').replace(/\/+$/, '');
if (!/^https:\/\/|^http:\/\/(localhost|127\.0\.0\.1|host\.docker\.internal)(:\d+)?$/.test(serverUrl)) {
  console.error('ORQ_URL precisa começar com https:// (ex.: https://orquidario-inteligente.SEU.workers.dev).');
  process.exit(1);
}
const version = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
const baseTopic = env('Z2M_BASE_TOPIC', 'zigbee2mqtt');

const collector = new Collector({ serverUrl, token: env('ORQ_INGEST_TOKEN'), baseTopic, dataDir: env('DATA_DIR', '/data'), version });
collector.log(`Coletor ${version} iniciado. Servidor: ${serverUrl}. Leituras na fila: ${collector.queue.size}.`);

const client = mqtt.connect(env('MQTT_URL', 'mqtt://mosquitto:1883'), {
  clientId: 'orquidario-coletor',
  reconnectPeriod: 5_000,
  connectTimeout: 10_000,
});
client.on('connect', () => {
  collector.setMqttConnected(true);
  collector.log('Conectado ao MQTT.');
  client.subscribe(`${baseTopic}/#`, { qos: 1 });
});
client.on('close', () => collector.setMqttConnected(false));
client.on('error', (e) => collector.log(`MQTT: ${e.message}`));
client.on('message', (topic, buf) => {
  try {
    collector.onMessage(topic, buf.toString('utf8'));
  } catch (e) {
    collector.log(`Erro ao tratar ${topic}: ${e?.message ?? e}`);
  }
});

const timer = setInterval(() => {
  collector.tick().catch((e) => collector.log(`Erro no envio: ${e?.message ?? e}`));
}, 5_000);

const stop = () => {
  clearInterval(timer);
  client.end(false, () => process.exit(0));
  setTimeout(() => process.exit(0), 3_000).unref();
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
