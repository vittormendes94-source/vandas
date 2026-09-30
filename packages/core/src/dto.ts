import type { AppConfig, Bucket, Dataset, HistoryResolution, IrrigationPeriod, Reading } from './types';
import type { RelayStatus } from './irrigation';

/**
 * Formatos JSON da API. Timestamps em ISO 8601 UTC ("...Z"). O cliente converte para America/Sao_Paulo ao exibir.
 */

export interface ReadingDto {
  sensorId: string;
  measuredAt: string;
  receivedAt: string;
  timeBasis: 'source' | 'received';
  temperatureC: number;
  humidityPct: number;
  batteryPct: number | null;
  linkQuality: number | null;
  rssiDbm: number | null;
  source: string;
}

export interface PeriodDto {
  startedAt: string;
  endedAt: string | null;
}

export interface RelayStatusDto {
  comm: RelayStatus['comm'];
  state: RelayStatus['state'];
  lastKnownState: 'on' | 'off' | null;
  lastSeenAt: string | null;
  lastStateAt: string | null;
}

export interface LiveResponse {
  dataset: Dataset;
  /** Hora do servidor no momento da resposta. A idade das leituras é calculada contra este instante. */
  serverTime: string;
  config: AppConfig;
  /** Última leitura conhecida de cada sensor (pode estar vencida). Ausente = nunca houve leitura. */
  latest: Record<string, ReadingDto | null>;
  relay: RelayStatusDto;
  /** Períodos recentes de irrigação (últimas 24 h) para contexto. */
  recentIrrigation: PeriodDto[];
  integration: IntegrationInfo;
}

export interface IntegrationInfo {
  /** Identifica a origem dos dados deste conjunto. */
  source: 'demo-simulator' | 'ingestion-api';
  demoEnabled: boolean;
  ewelink: { state: 'not_configured' | 'pending_validation'; note: string };
  writeAuthConfigured: boolean;
  ingestAuthConfigured: boolean;
}

/**
 * Histórico em formato compacto (menos bytes e menos CPU no Worker).
 *  - resolution "raw":    linha = [medidoEm(ms), temperaturaC, umidadePct]
 *                         com detail=full: [..., recebidoEm(ms), bateriaPct|null, lqi|null, rssiDbm|null, baseTempo(0=origem,1=recebimento)]
 *  - resolution "hourly": linha = [inicioDaHora(ms), tMédia, tMín, tMáx, uMédia, uMín, uMáx, n]
 * Todos os instantes em UTC (epoch ms).
 */
export interface HistorySeries {
  sensorId: string;
  rows: (number | null)[][];
}

export interface HistoryResponse {
  dataset: Dataset;
  from: string;
  to: string;
  resolution: HistoryResolution;
  detail: 'basic' | 'full';
  series: HistorySeries[];
  irrigation: PeriodDto[];
  /** true se o limite de linhas por sensor cortou a resposta (os dados mais antigos foram omitidos). */
  truncated: boolean;
}

export const iso = (ms: number): string => new Date(ms).toISOString();

export function readingToDto(r: Reading): ReadingDto {
  return { ...r, measuredAt: iso(r.measuredAt), receivedAt: iso(r.receivedAt) };
}

export function readingFromDto(d: ReadingDto): Reading {
  return { ...d, measuredAt: Date.parse(d.measuredAt), receivedAt: Date.parse(d.receivedAt) };
}

/** Converte linhas compactas em Buckets (pontos brutos viram buckets com n=1 e min=max=média). */
export function bucketsFromHistory(h: Pick<HistoryResponse, 'resolution' | 'series'>): Bucket[] {
  const out: Bucket[] = [];
  for (const s of h.series) {
    for (const r of s.rows) {
      if (h.resolution === 'raw') {
        const [t, temp, hum] = r as [number, number, number];
        out.push({ sensorId: s.sensorId, t, tAvg: temp, tMin: temp, tMax: temp, hAvg: hum, hMin: hum, hMax: hum, n: 1 });
      } else {
        const [t, tAvg, tMin, tMax, hAvg, hMin, hMax, n] = r as number[];
        out.push({ sensorId: s.sensorId, t: t!, tAvg: tAvg!, tMin: tMin!, tMax: tMax!, hAvg: hAvg!, hMin: hMin!, hMax: hMax!, n: n! });
      }
    }
  }
  return out;
}

/** Reconstrói leituras completas (detail=full, resolução bruta) para exportação e comparações. */
export function readingsFromFullHistory(h: HistoryResponse, source: string): Reading[] {
  if (h.resolution !== 'raw' || h.detail !== 'full') return [];
  const out: Reading[] = [];
  for (const s of h.series) {
    for (const r of s.rows) {
      const [t, temp, hum, rec, bat, lqi, rssi, basis] = r as (number | null)[];
      out.push({
        sensorId: s.sensorId,
        measuredAt: t!,
        receivedAt: rec ?? t!,
        timeBasis: basis === 1 ? 'received' : 'source',
        temperatureC: temp!,
        humidityPct: hum!,
        batteryPct: bat ?? null,
        linkQuality: lqi ?? null,
        rssiDbm: rssi ?? null,
        source,
      });
    }
  }
  return out;
}

export function periodToDto(p: IrrigationPeriod): PeriodDto {
  return { startedAt: iso(p.startedAt), endedAt: p.endedAt === null ? null : iso(p.endedAt) };
}

export function periodFromDto(d: PeriodDto): IrrigationPeriod {
  return { startedAt: Date.parse(d.startedAt), endedAt: d.endedAt === null ? null : Date.parse(d.endedAt) };
}
