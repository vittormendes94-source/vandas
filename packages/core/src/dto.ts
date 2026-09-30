import type { AppConfig, Bucket, HistoryResolution, Reading } from './types';
import type { PumpComm, PumpState } from './pump';

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

/** Situação informada pelo provedor (eWeLink) para o dispositivo vinculado a um sensor. */
export interface SensorLinkDto {
  deviceId: string | null;
  deviceName: string | null;
  /** Online segundo o eWeLink na última leitura da integração. null = não informado / não vinculado. */
  online: boolean | null;
  /** Última leitura bem-sucedida da integração que incluiu o dispositivo. */
  seenAt: string | null;
}

export interface PumpDto {
  comm: PumpComm;
  state: PumpState;
  seenAt: string | null;
  deviceName: string | null;
}

export interface EwelinkStatusDto {
  /** APPID e segredo configurados no servidor. */
  configured: boolean;
  /** Conta autorizada (tokens guardados). */
  connected: boolean;
  region: string | null;
  connectedAt: string | null;
  lastPollAt: string | null;
  lastSuccessAt: string | null;
  lastError: { at: string; code: string; message: string } | null;
  consecutiveFailures: number;
  callsThisMonth: number;
  monthlyLimit: number;
  accessExpiresAt: string | null;
  refreshExpiresAt: string | null;
  /** Validade da credencial de desenvolvedor pessoal (1 ano), se informada no servidor. */
  appExpiresAt: string | null;
}

export interface IntegrationStatusDto {
  ewelink: EwelinkStatusDto;
  writeAuthConfigured: boolean;
  ingestAuthConfigured: boolean;
}

export interface LiveResponse {
  /** Hora do servidor no momento da resposta. A idade das leituras é calculada contra este instante. */
  serverTime: string;
  config: AppConfig;
  /** Última leitura conhecida de cada sensor (pode estar vencida). null = nunca houve leitura. */
  latest: Record<string, ReadingDto | null>;
  links: Record<string, SensorLinkDto>;
  pump: PumpDto;
  integration: IntegrationStatusDto;
}

/** Dispositivo encontrado na conta eWeLink (para vincular sensores e bomba em Configurações). */
export interface ProviderDeviceDto {
  deviceId: string;
  name: string;
  uiid: number | null;
  model: string | null;
  online: boolean | null;
  /** climate = sensor de temperatura/umidade suportado; switch = tem liga/desliga; unsupported = formato não verificado. */
  kind: 'climate' | 'switch' | 'unsupported';
  temperatureC: number | null;
  humidityPct: number | null;
  switchState: 'on' | 'off' | null;
  measuredAt: string | null;
  seenAt: string;
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
  from: string;
  to: string;
  resolution: HistoryResolution;
  detail: 'basic' | 'full';
  series: HistorySeries[];
  /** true se o limite de linhas por sensor cortou a resposta (os dados mais antigos foram omitidos). */
  truncated: boolean;
}

export const iso = (ms: number): string => new Date(ms).toISOString();
export const isoOrNull = (ms: number | null | undefined): string | null => (ms === null || ms === undefined ? null : iso(ms));

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

/** Reconstrói leituras completas (detail=full, resolução bruta) para exportação. */
export function readingsFromFullHistory(h: HistoryResponse): Reading[] {
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
        source: '',
      });
    }
  }
  return out;
}
