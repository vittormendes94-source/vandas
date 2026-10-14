// Regras puras do coletor (sem rede, sem disco): interpretar mensagens do Zigbee2MQTT e montar leituras.
//
// O Zigbee2MQTT roda com `cache_state: false` e `last_seen: ISO_8601` (o instalador grava assim). Com isso, cada
// mensagem de um sensor traz SOMENTE o que o sensor acabou de informar, mais `last_seen` = instante em que a mensagem
// chegou. O SNZB-02WD informa temperatura e umidade separadamente (a cada variação de 0,2 °C / 1 % e, no máximo, a cada
// hora). Cada vez que chega temperatura OU umidade, a leitura é montada com o valor novo e o último valor informado da
// outra grandeza — que, por definição do aparelho, não mudou além do limiar desde então.

export const LIMITS = { tMin: -40, tMax: 85, hMin: 0, hMax: 100 };

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Procura `property` nos "exposes" da definição (inclui recursos aninhados). */
function exposes(list, property) {
  for (const e of list ?? []) {
    if (e?.property === property) return true;
    if (Array.isArray(e?.features) && exposes(e.features, property)) return true;
  }
  return false;
}

/**
 * Lista de dispositivos publicada em `<base>/bridge/devices`. Ignora o coordenador e aparelhos ainda não
 * reconhecidos. Retorna mapa nome amigável → dados.
 */
export function parseBridgeDevices(payload) {
  const map = new Map();
  if (!Array.isArray(payload)) return map;
  for (const d of payload) {
    if (!d || d.type === 'Coordinator' || typeof d.ieee_address !== 'string' || typeof d.friendly_name !== 'string') continue;
    if (!/^0x[0-9a-f]{16}$/.test(d.ieee_address)) continue;
    const def = d.definition ?? null;
    map.set(d.friendly_name, {
      ieee: d.ieee_address,
      name: d.friendly_name.slice(0, 80),
      model: typeof def?.model === 'string' ? def.model.slice(0, 80) : null,
      vendor: typeof def?.vendor === 'string' ? def.vendor.slice(0, 80) : null,
      climate: !!def && exposes(def.exposes, 'temperature') && exposes(def.exposes, 'humidity'),
    });
  }
  return map;
}

/** `bridge/state` vem como JSON {"state":"online"} (versões novas) ou texto "online" (antigas). */
export function parseBridgeState(text) {
  let v = text.trim();
  try {
    const j = JSON.parse(v);
    v = typeof j === 'string' ? j : j?.state;
  } catch {
    /* texto puro */
  }
  return v === 'online' ? true : v === 'offline' ? false : null;
}

/** Confere em `bridge/info` se o Zigbee2MQTT está configurado do jeito que o coletor exige. */
export function checkBridgeConfig(info) {
  const adv = info?.config?.advanced;
  if (!adv) return null; // ainda sem informação
  if (adv.cache_state !== false) return 'Zigbee2MQTT com cache_state ligado: as leituras não são enviadas (reinstale com o instalador).';
  if (!['ISO_8601', 'ISO_8601_local', 'epoch'].includes(adv.last_seen))
    return 'Zigbee2MQTT sem last_seen: as leituras não são enviadas (reinstale com o instalador).';
  return null;
}

/** Instante da mensagem: `last_seen` (ISO ou epoch ms); se ausente/inválido, o instante de chegada ao coletor. */
export function messageTime(payload, receivedAt) {
  const ls = payload?.last_seen;
  const t = typeof ls === 'number' ? ls : typeof ls === 'string' ? Date.parse(ls) : NaN;
  return Number.isFinite(t) && t > 1.5e12 ? t : receivedAt;
}

/**
 * Estado por sensor (último valor de cada grandeza). `apply` recebe uma mensagem já decodificada e devolve a leitura
 * a enviar, ou null quando a mensagem não trouxe temperatura/umidade (ex.: só bateria) ou quando ainda falta a outra
 * grandeza (logo após instalar).
 */
export class SensorTracker {
  constructor(snapshot = {}) {
    /** @type {Map<string, {t:number|null,tAt:number|null,h:number|null,hAt:number|null,battery:number|null,lqi:number|null,lastSeen:number|null}>} */
    this.state = new Map(Object.entries(snapshot));
  }

  get(ieee) {
    let s = this.state.get(ieee);
    if (!s) this.state.set(ieee, (s = { t: null, tAt: null, h: null, hAt: null, battery: null, lqi: null, lastSeen: null }));
    return s;
  }

  apply(ieee, payload, receivedAt) {
    if (!payload || typeof payload !== 'object') return null;
    const at = messageTime(payload, receivedAt);
    const s = this.get(ieee);
    s.lastSeen = Math.max(s.lastSeen ?? 0, at);
    const battery = num(payload.battery);
    if (battery !== null && battery >= 0 && battery <= 100) s.battery = battery;
    const lqi = num(payload.linkquality);
    if (lqi !== null && lqi >= 0 && lqi <= 255) s.lqi = lqi;

    const t = num(payload.temperature);
    const h = num(payload.humidity);
    const tOk = t !== null && t >= LIMITS.tMin && t <= LIMITS.tMax;
    const hOk = h !== null && h >= LIMITS.hMin && h <= LIMITS.hMax;
    // Mensagem antiga chegando depois de uma mais nova (raro): não sobrescreve o valor mais recente.
    if (tOk && at >= (s.tAt ?? 0)) Object.assign(s, { t, tAt: at });
    if (hOk && at >= (s.hAt ?? 0)) Object.assign(s, { h, hAt: at });
    if (!tOk && !hOk) return null;
    if (s.t === null || s.h === null) return null;
    return {
      ieee,
      measuredAt: new Date(at).toISOString(),
      temperatureC: round(tOk ? t : s.t, 2),
      humidityPct: round(hOk ? h : s.h, 2),
      batteryPct: s.battery,
      linkQuality: s.lqi,
    };
  }

  snapshot() {
    return Object.fromEntries(this.state);
  }
}

const round = (v, d) => Math.round(v * 10 ** d) / 10 ** d;

/** Retrato dos dispositivos para o servidor (até 200). */
export function devicesPayload(devicesByName, tracker) {
  return [...devicesByName.values()].slice(0, 200).map((d) => {
    const s = tracker.state.get(d.ieee);
    return {
      ieee: d.ieee,
      name: d.name,
      model: d.model,
      vendor: d.vendor,
      climate: d.climate,
      temperatureC: s?.t ?? null,
      humidityPct: s?.h ?? null,
      batteryPct: s?.battery ?? null,
      linkQuality: s?.lqi ?? null,
      lastSeen: s?.lastSeen ? new Date(s.lastSeen).toISOString() : null,
    };
  });
}

/** Tópico de um dispositivo → nome amigável; null para tópicos que não são o estado de um aparelho. */
export function deviceNameFromTopic(base, topic) {
  if (!topic.startsWith(`${base}/`)) return null;
  const name = topic.slice(base.length + 1);
  if (!name || name.startsWith('bridge/') || /\/(availability|set|get)(\/.*)?$/.test(name)) return null;
  return name;
}
