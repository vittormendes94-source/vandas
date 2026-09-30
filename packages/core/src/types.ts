/**
 * Tipos de domínio compartilhados entre Worker e interface.
 *
 * Convenções:
 *  - Timestamps internos são inteiros em milissegundos UTC (epoch).
 *  - Nas fronteiras HTTP (API/CSV) os timestamps trafegam como ISO 8601 em UTC.
 *  - Apresentação sempre em America/Sao_Paulo (ver time.ts).
 */

/** Dimensões fixas informadas do orquidário. */
export const ROOM = { lengthM: 12, widthM: 5 } as const;
export const ROOM_AREA_M2 = ROOM.lengthM * ROOM.widthM;

export type Quantity = 'temperature' | 'humidity';

/** Como o instante de uma leitura foi determinado. */
export type TimeBasis = 'source' | 'received';

export interface Reading {
  sensorId: string;
  /** Instante da medição (UTC ms). Se a origem não informou, é igual a receivedAt e timeBasis='received'. */
  measuredAt: number;
  /** Instante em que o sistema recebeu a leitura (UTC ms). Nunca é alterado por refresh de tela. */
  receivedAt: number;
  timeBasis: TimeBasis;
  temperatureC: number;
  humidityPct: number;
  /** Só existe quando a integração fornece. */
  batteryPct: number | null;
  /** Zigbee LQI (0–255), quando fornecido. */
  linkQuality: number | null;
  rssiDbm: number | null;
  source: string;
}

/** Estado de comunicação de um sensor em determinado instante. */
export type Freshness = 'fresh' | 'delayed' | 'unavailable';

export interface SensorConfig {
  id: string;
  name: string;
  /** Posição em metros a partir do canto superior esquerdo: x ao longo dos 12 m, y ao longo dos 5 m. */
  xM: number;
  yM: number;
  /** Verdadeiro enquanto a posição for provisória (ainda não medida no local). */
  positionProvisional: boolean;
  /** deviceid do sensor no eWeLink (ou outro provedor). null = ainda não vinculado. */
  externalId?: string | null;
}

export interface Sprinkler {
  id: string;
  label: string;
  xM: number;
  yM: number;
  /** Alcance ilustrativo em metros (não medido). */
  radiusM: number;
}

export interface Limits {
  min: number | null;
  max: number | null;
}

export interface AppConfig {
  /** Controle otimista de concorrência: incrementa a cada gravação. */
  revision: number;
  sensors: SensorConfig[];
  freshness: {
    /** Idade máxima (min) para a leitura contar como atualizada. */
    freshMaxMin: number;
    /** Acima disso o sensor é tratado como indisponível (sem comunicação). Entre os dois: atrasado. */
    offlineAfterMin: number;
  };
  replay: {
    /** Tolerância (min) para combinar leituras de sensores diferentes num mesmo instante. */
    toleranceMin: number;
  };
  /** Limites definidos pelo usuário. Todos null = nenhum alerta. */
  alerts: {
    temperature: Limits;
    humidity: Limits;
    dpv: Limits;
  };
  scales: {
    temperature: { min: number; max: number };
    humidity: { min: number; max: number };
  };
  orientation: {
    /** Ângulo, em graus no sentido horário a partir do "topo" do mapa, para onde aponta o Norte. null = não informado. */
    northAngleDeg: number | null;
  };
  /** Planta dos aspersores: apenas desenho de referência. */
  irrigation: {
    sprinklers: Sprinkler[];
    layoutProvisional: boolean;
  };
  /** Bomba: só o estado atual (ligada/desligada) informado pelo Sonoff. Nada é registrado em histórico. */
  pump: {
    /** deviceid do Sonoff da bomba no eWeLink. null = não vinculado. */
    deviceId: string | null;
    /** Canal (0 = primeiro) em Sonoff de vários canais. */
    outlet: number;
  };
  retention: {
    /** Dias de leituras brutas mantidas. O histórico horário agregado é mantido por mais tempo. */
    rawDays: number;
  };
}

/** Agregado horário (ou ponto bruto, com n=1 e min=max=avg). */
export interface Bucket {
  sensorId: string;
  /** Início do intervalo (UTC ms). Para pontos brutos, é o próprio measuredAt. */
  t: number;
  tAvg: number;
  tMin: number;
  tMax: number;
  hAvg: number;
  hMin: number;
  hMax: number;
  n: number;
}

export type HistoryResolution = 'raw' | 'hourly';
