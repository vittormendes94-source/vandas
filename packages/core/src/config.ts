import { z } from 'zod';
import { ROOM } from './types';
import type { AppConfig, Dataset } from './types';

const id = z.string().regex(/^[a-z0-9_-]{1,32}$/, 'Use 1–32 caracteres: a–z, 0–9, "_" ou "-".');
const name = z.string().trim().min(1).max(60);
const finite = z.number().finite();
const limit = z.number().finite().nullable();

const limits = z
  .strictObject({ min: limit, max: limit })
  .refine((l) => l.min === null || l.max === null || l.min < l.max, 'O mínimo deve ser menor que o máximo.');

export const SensorConfigSchema = z.strictObject({
  id,
  name,
  xM: finite.min(0).max(ROOM.lengthM),
  yM: finite.min(0).max(ROOM.widthM),
  positionProvisional: z.boolean(),
  externalId: z.string().trim().max(80).nullable().optional(),
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
    alerts: z.strictObject({
      temperature: limits,
      humidity: limits,
      dpv: limits,
      demonstrative: z.boolean(),
    }),
    scales: z.strictObject({
      temperature: z
        .strictObject({ min: finite, max: finite })
        .refine((s) => s.min < s.max, 'Escala inválida.'),
      humidity: z
        .strictObject({ min: finite.min(0).max(100), max: finite.min(0).max(100) })
        .refine((s) => s.min < s.max, 'Escala inválida.'),
    }),
    orientation: z.strictObject({ northAngleDeg: z.number().finite().min(0).lt(360).nullable() }),
    irrigation: z.strictObject({
      sprinklers: z.array(SprinklerSchema).max(40),
      layoutProvisional: z.boolean(),
      informedSchedule: z.string().trim().max(200).nullable(),
      relayFreshMaxMin: z.number().min(1).max(10080).nullable(),
      comparisonWindowMin: z.number().min(5).max(240),
    }),
    retention: z.strictObject({ rawDays: z.number().int().min(7).max(90) }),
  })
  .superRefine((c, ctx) => {
    const seen = new Set<string>();
    c.sensors.forEach((s, i) => {
      if (seen.has(s.id)) ctx.addIssue({ code: 'custom', path: ['sensors', i, 'id'], message: 'Identificador de sensor repetido.' });
      seen.add(s.id);
    });
    const seenS = new Set<string>();
    c.irrigation.sprinklers.forEach((s, i) => {
      if (seenS.has(s.id)) ctx.addIssue({ code: 'custom', path: ['irrigation', 'sprinklers', i, 'id'], message: 'Identificador de aspersor repetido.' });
      seenS.add(s.id);
    });
  });

/** Corpo aceito em PUT /api/config: mesma forma, `revision` = revisão atual conhecida pelo cliente. */
export const ConfigUpdateSchema = AppConfigSchema;

/**
 * Configuração inicial. Posições e aspersores são PROVISÓRIOS: só existem para a interface ter o que desenhar
 * até que o usuário informe a distribuição real.
 */
export function defaultConfig(dataset: Dataset): AppConfig {
  return {
    revision: 0,
    sensors: [
      { id: 's1', name: 'Setor A', xM: 2.5, yM: 1.5, positionProvisional: true, externalId: null },
      { id: 's2', name: 'Centro', xM: 6.0, yM: 3.5, positionProvisional: true, externalId: null },
      { id: 's3', name: 'Setor B', xM: 10.0, yM: 1.5, positionProvisional: true, externalId: null },
    ],
    // Valores iniciais: a frequência efetiva de envio dos SNZB-02WD ainda NÃO foi observada.
    // Ajuste em Configurações após medir o intervalo real entre leituras.
    freshness: { freshMaxMin: 15, offlineAfterMin: 60 },
    replay: { toleranceMin: 15 },
    alerts:
      dataset === 'demo'
        ? {
            // Valores de DEMONSTRAÇÃO. Não são recomendações agronômicas.
            temperature: { min: 18, max: 32 },
            humidity: { min: 50, max: 85 },
            dpv: { min: null, max: null },
            demonstrative: true,
          }
        : {
            temperature: { min: null, max: null },
            humidity: { min: null, max: null },
            dpv: { min: null, max: null },
            demonstrative: false,
          },
    // Escalas fixas apenas para comparar momentos diferentes na mesma cor. Não representam faixa ideal.
    scales: { temperature: { min: 15, max: 35 }, humidity: { min: 30, max: 100 } },
    // A orientação real do orquidário ainda não foi informada.
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
      informedSchedule: 'Rega informada: manhã e tarde · 5 min/ciclo · horários pendentes',
      relayFreshMaxMin: dataset === 'demo' ? 30 : null,
      comparisonWindowMin: 30,
    },
    retention: { rawDays: 45 },
  };
}

/** Mescla parcial do que está salvo sobre os padrões, para tolerar campos adicionados em versões futuras. */
export function parseStoredConfig(raw: unknown, dataset: Dataset): AppConfig {
  const base = defaultConfig(dataset);
  const merged = { ...base, ...(typeof raw === 'object' && raw ? (raw as object) : {}) };
  const r = AppConfigSchema.safeParse(merged);
  return r.success ? (r.data as AppConfig) : base;
}
