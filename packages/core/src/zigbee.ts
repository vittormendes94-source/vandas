import { z } from 'zod';

/**
 * Contrato do coletor local (Zigbee2MQTT → servidor) — ver docs/CONTRATO-DE-LEITURAS.md.
 *
 * POST /api/v1/ingest/zigbee   Authorization: Bearer <INGEST_TOKEN>
 * O coletor envia, no mesmo corpo: o próprio estado (sempre), o retrato dos dispositivos (a cada 5 min ou quando a lista
 * muda) e as leituras novas. Os sensores são identificados pelo endereço IEEE do Zigbee; o servidor converte para S1–S3
 * pelo vínculo feito em Configurações.
 */

export const ZIGBEE_PROVIDER = 'zigbee2mqtt';

const ieee = z.string().regex(/^0x[0-9a-f]{16}$/);
const isoTime = z.iso.datetime({ offset: true });

export const ZigbeeDeviceSchema = z.strictObject({
  ieee,
  name: z.string().min(1).max(80),
  model: z.string().max(80).nullish(),
  vendor: z.string().max(80).nullish(),
  /** O dispositivo informa temperatura e umidade (definição do Zigbee2MQTT). */
  climate: z.boolean(),
  temperatureC: z.number().finite().min(-40).max(85).nullish(),
  humidityPct: z.number().finite().min(0).max(100).nullish(),
  batteryPct: z.number().finite().min(0).max(100).nullish(),
  linkQuality: z.number().finite().min(0).max(255).nullish(),
  /** Última mensagem recebida do dispositivo (relógio do coletor). */
  lastSeen: isoTime.nullish(),
});

export const ZigbeeReadingSchema = z.strictObject({
  ieee,
  /** Instante em que o Zigbee2MQTT recebeu a medição do sensor (`last_seen`). Obrigatório. */
  measuredAt: isoTime,
  temperatureC: z.number().finite().min(-40).max(85),
  humidityPct: z.number().finite().min(0).max(100),
  batteryPct: z.number().finite().min(0).max(100).nullish(),
  linkQuality: z.number().finite().min(0).max(255).nullish(),
});

export const CollectorStatusSchema = z.strictObject({
  version: z.string().min(1).max(40),
  startedAt: isoTime,
  /** Relógio do coletor no envio. O servidor compara com o próprio relógio. */
  sentAt: isoTime,
  mqttConnected: z.boolean(),
  /** Estado do Zigbee2MQTT (tópico bridge/state). null = ainda desconhecido. */
  bridgeOnline: z.boolean().nullable(),
  /** Leituras guardadas em disco esperando envio (ex.: internet caiu). */
  queued: z.number().int().min(0),
  /** Problema de configuração que impede enviar leituras (ex.: Zigbee2MQTT com cache_state ligado). */
  problem: z.string().max(300).nullable(),
});

export const ZigbeeIngestBodySchema = z.strictObject({
  collector: CollectorStatusSchema,
  devices: z.array(ZigbeeDeviceSchema).max(200).optional(),
  readings: z.array(ZigbeeReadingSchema).max(100).default([]),
});

export type ZigbeeDevice = z.infer<typeof ZigbeeDeviceSchema>;
export type ZigbeeReading = z.infer<typeof ZigbeeReadingSchema>;
export type ZigbeeIngestBody = z.infer<typeof ZigbeeIngestBodySchema>;

export type ZigbeeReadingOutcome =
  | { index: number; status: 'accepted' | 'duplicate' | 'unlinked' }
  | { index: number; status: 'rejected'; reason: 'future_timestamp' | 'too_old' };

/** Diferença de relógio (coletor − servidor) a partir da qual o painel avisa. */
export const COLLECTOR_CLOCK_WARN_MS = 2 * 60_000;
/** Sem contato do coletor por mais que isto → "sem contato". O coletor envia sinal de vida a cada 5 min. */
export const COLLECTOR_STALE_MS = 15 * 60_000;
