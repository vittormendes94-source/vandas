import { z } from 'zod';
import { ROOM } from './types';
import type { AppConfig } from './types';

const id = z.string().regex(/^[a-z0-9_-]{1,32}$/, 'Use 1–32 caracteres: a–z, 0–9, "_" ou "-".');
const name = z.string().trim().min(1).max(60);
const finite = z.number().finite();
const limit = z.number().finite().nullable();
const deviceId = z.string().trim().regex(/^[A-Za-z0-9_-]{1,64}$/, 'Identificador de dispositivo inválido.');

const limits = z
  .strictObject({ min: limit, max: limit })
  .refine((l) => l.min === null || l.max === null || l.min < l.max, 'O mínimo deve ser menor que o máximo.');

export const SensorConfigSchema = z.strictObject({
  id,
  name,
  xM: finite.min(0).max(ROOM.lengthM),
  yM: finite.min(0).max(ROOM.widthM),
  positionProvisional: z.boolean(),
  externalId: deviceId.nullable().optional(),
});

export const SprinklerSchema = z.strictObject({
  id,
  label: name,
  xM: finite.min(0).max(ROOM.lengthM),
  yM: finite.min(0).max(ROOM.widthM),
  radiusM: finite.min(0.5).max(6),
});

export const AppConfigSchema = z
  .strictObject({
    revision: z.number().int().min(0),
    sensors: z.array(SensorConfigSchema).min(1).max(8),
    freshness: z
      .strictObject({
        freshMaxMin: z.number().min(1).max(1440),
        offlineAfterMin: z.number().min(1).max(10080),
      })
      .refine((f) => f.freshMaxMin < f.offlineAfterMin, 'O limite de "atrasado" deve ser menor que o de "sem comunicação".'),
    replay: z.strictObject({ toleranceMin: z.number().min(1).max(180) }),
    alerts: z.strictObject({ temperature: limits, humidity: limits, dpv: limits }),
    scales: z.strictObject({
      temperature: z.strictObject({ min: finite, max: finite }).refine((s) => s.min < s.max, 'Escala inválida.'),
      humidity: z
        .strictObject({ min: finite.min(0).max(100), max: finite.min(0).max(100) })
        .refine((s) => s.min < s.max, 'Escala inválida.'),
    }),
    orientation: z.strictObject({ northAngleDeg: z.number().finite().min(0).lt(360).nullable() }),
    irrigation: z.strictObject({
      sprinklers: z.array(SprinklerSchema).max(40),
      layoutProvisional: z.boolean(),
    }),
    pump: z.strictObject({ deviceId: deviceId.nullable(), outlet: z.number().int().min(0).max(3) }),
    retention: z.strictObject({ rawDays: z.number().int().min(7).max(90) }),
  })
  .superRefine((c, ctx) => {
    const seen = new Set<string>();
    c.sensors.forEach((s, i) => {
      if (seen.has(s.id)) ctx.addIssue({ code: 'custom', path: ['sensors', i, 'id'], message: 'Identificador de sensor repetido.' });
      seen.add(s.id);
    });
    const ext = new Set<string>();
    c.sensors.forEach((s, i) => {
      if (!s.externalId) return;
      if (ext.has(s.externalId)) ctx.addIssue({ code: 'custom', path: ['sensors', i, 'externalId'], message: 'O mesmo dispositivo está vinculado a dois sensores.' });
      ext.add(s.externalId);
    });
    if (c.pump.deviceId && ext.has(c.pump.deviceId)) {
      ctx.addIssue({ code: 'custom', path: ['pump', 'deviceId'], message: 'O dispositivo da bomba não pode ser um sensor.' });
    }
    const seenS = new Set<string>();
    c.irrigation.sprinklers.forEach((s, i) => {
      if (seenS.has(s.id)) ctx.addIssue({ code: 'custom', path: ['irrigation', 'sprinklers', i, 'id'], message: 'Identificador de aspersor repetido.' });
      seenS.add(s.id);
    });
  });

/** Corpo aceito em PUT /api/config: mesma forma, `revision` = revisão atual conhecida pelo cliente. */
export const ConfigUpdateSchema = AppConfigSchema;

/**
 * Configuração inicial. Posições dos sensores e aspersores são PROVISÓRIAS (marcadas como tal) até o usuário
 * informar as reais. Nenhum limite de alerta vem pré-definido.
 */
export function defaultConfig(): AppConfig {
  return {
    revision: 0,
    sensors: [
      { id: 's1', name: 'Sensor 1', xM: 2.5, yM: 1.5, positionProvisional: true, externalId: null },
      { id: 's2', name: 'Sensor 2', xM: 6.0, yM: 3.5, positionProvisional: true, externalId: null },
      { id: 's3', name: 'Sensor 3', xM: 10.0, yM: 1.5, positionProvisional: true, externalId: null },
    ],
    // Sensores Zigbee costumam reportar quando o valor varia (e periodicamente). O intervalo real do SNZB-02WD
    // ainda não foi observado: ajuste depois da primeira semana com os sensores instalados.
    freshness: { freshMaxMin: 60, offlineAfterMin: 180 },
    replay: { toleranceMin: 30 },
    alerts: {
      temperature: { min: null, max: null },
      humidity: { min: null, max: null },
      dpv: { min: null, max: null },
    },
    // Escalas fixas apenas para comparar momentos diferentes na mesma cor. Não representam faixa ideal.
    scales: { temperature: { min: 15, max: 35 }, humidity: { min: 30, max: 100 } },
    orientation: { northAngleDeg: null },
    irrigation: {
      sprinklers: [
        { id: 'a1', label: 'A1', xM: 2, yM: 1.25, radiusM: 1.8 },
        { id: 'a2', label: 'A2', xM: 6, yM: 1.25, radiusM: 1.8 },
        { id: 'a3', label: 'A3', xM: 10, yM: 1.25, radiusM: 1.8 },
        { id: 'a4', label: 'A4', xM: 2, yM: 3.75, radiusM: 1.8 },
        { id: 'a5', label: 'A5', xM: 6, yM: 3.75, radiusM: 1.8 },
        { id: 'a6', label: 'A6', xM: 10, yM: 3.75, radiusM: 1.8 },
      ],
      layoutProvisional: true,
    },
    pump: { deviceId: null, outlet: 0 },
    retention: { rawDays: 45 },
  };
}

/** Mescla o que está salvo sobre os padrões (tolera campos adicionados em versões futuras). Inválido → padrão. */
export function parseStoredConfig(raw: unknown): AppConfig {
  const base = defaultConfig();
  const merged = { ...base, ...(typeof raw === 'object' && raw ? (raw as object) : {}) };
  const r = AppConfigSchema.safeParse(merged);
  return r.success ? (r.data as AppConfig) : base;
}
