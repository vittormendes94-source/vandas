/**
 * "Visão simples": traduz o estado técnico (frescor, limites, bomba) em frases curtas e cores, para quem não é técnico.
 * Regras:
 *  - Só sensores ATUALIZADOS entram na avaliação (iguais às médias e ao mapa).
 *  - "Bom/atenção" só existe quando o dono configurou limites; sem limites, o valor aparece sem julgamento.
 *  - Bomba fora do ar NÃO vira "desligada": vira "sem informação".
 */
import type { PumpDto } from './dto';
import { formatAge } from './time';
import type { AlertHit } from './snapshot';
import { evaluateAlerts } from './snapshot';
import type { Snapshot } from './snapshot';
import type { AppConfig, Limits } from './types';

export type SimpleLevel = 'ok' | 'warn' | 'bad' | 'setup';
export type ValueTone = 'ok' | 'low' | 'high' | 'none';

export interface SimpleStatus {
  level: SimpleLevel;
  headline: string;
  /** Linhas curtas, em linguagem do dia a dia (máx. 4). */
  details: string[];
}

const WORDS: Record<AlertHit['kind'], { above: string; below: string }> = {
  temperature: { above: 'Está quente', below: 'Está frio' },
  humidity: { above: 'Umidade muito alta', below: 'Ar seco' },
  dpv: { above: 'Ar secando as plantas (DPV alto)', below: 'Ar muito saturado (DPV baixo)' },
};
const UNIT: Record<AlertHit['kind'], string> = { temperature: '°C', humidity: '%', dpv: 'kPa' };

const fmt = (v: number, d: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });

/** Classifica um valor contra os limites do dono. Sem limites (ou sem valor), 'none'. */
export function valueTone(value: number | null | undefined, limits: Limits): ValueTone {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'none';
  if (limits.min === null && limits.max === null) return 'none';
  if (limits.min !== null && value < limits.min) return 'low';
  if (limits.max !== null && value > limits.max) return 'high';
  return 'ok';
}

export function limitsConfigured(alerts: AppConfig['alerts']): boolean {
  return [alerts.temperature, alerts.humidity, alerts.dpv].some((l) => l.min !== null || l.max !== null);
}

/** É noite (pelo período configurado) no instante dado, em São Paulo? */
export function isNight(config: Pick<AppConfig, 'nightTemperature'>, ms: number): boolean {
  const hm = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(ms);
  const { from, to } = config.nightTemperature;
  return from < to ? hm >= from && hm < to : hm >= from || hm < to;
}

/** Limites valendo agora: de noite, a temperatura usa a faixa da noite (se definida). */
export function activeAlerts(config: Pick<AppConfig, 'alerts' | 'nightTemperature'>, ms: number): AppConfig['alerts'] {
  const n = config.nightTemperature.limits;
  if ((n.min === null && n.max === null) || !isNight(config, ms)) return config.alerts;
  return { ...config.alerts, temperature: n };
}

export function simpleStatus(snapshot: Snapshot, config: AppConfig, nowMs: number): SimpleStatus {
  const total = snapshot.sensors.length;
  const linked = config.sensors.filter((s) => s.externalId).length;
  const { fresh } = snapshot.counts;

  if (fresh === 0) {
    if (snapshot.lastMeasuredAt === null) {
      return {
        level: 'setup',
        headline: 'Aguardando os sensores',
        details: [linked === 0 ? 'Os sensores ainda não foram ligados ao painel.' : 'Ainda não chegou nenhuma leitura dos sensores.'],
      };
    }
    return {
      level: 'bad',
      headline: `Sem notícias dos sensores ${formatAge(nowMs - snapshot.lastMeasuredAt)}`,
      details: ['Confira se o hub está na tomada e se a internet está funcionando.'],
    };
  }

  const details: string[] = [];
  const name = (id: string) => config.sensors.find((s) => s.id === id)?.name ?? id;

  // Fora da faixa: agrupa por tipo + sentido, mostrando o pior valor.
  const hits = evaluateAlerts(snapshot, activeAlerts(config, nowMs));
  const groups = new Map<string, AlertHit[]>();
  for (const h of hits) {
    const k = `${h.kind}:${h.direction}`;
    groups.set(k, [...(groups.get(k) ?? []), h]);
  }
  const order: AlertHit['kind'][] = ['temperature', 'humidity', 'dpv'];
  const sortedGroups = [...groups.values()].sort((a, b) => order.indexOf(a[0]!.kind) - order.indexOf(b[0]!.kind));
  for (const g of sortedGroups) {
    const h0 = g[0]!;
    const worst = g.reduce((w, h) => (h.direction === 'above' ? (h.value > w.value ? h : w) : h.value < w.value ? h : w), h0);
    const d = h0.kind === 'dpv' ? 2 : h0.kind === 'humidity' ? 0 : 1;
    const where = g.length === fresh ? 'em todo o orquidário' : g.map((h) => name(h.sensorId)).join(', ');
    details.push(`${WORDS[h0.kind][h0.direction]}: ${fmt(worst.value, d)} ${UNIT[h0.kind]} (${where}; limite ${fmt(h0.limit, d)} ${UNIT[h0.kind]})`);
  }

  // Sensores sem sinal (outros funcionando).
  for (const s of snapshot.sensors) {
    if (s.valid) continue;
    details.push(s.ageMs === null ? `${s.sensor.name}: nenhuma leitura ainda` : `${s.sensor.name} sem sinal ${formatAge(s.ageMs)}`);
  }

  if (hits.length > 0) {
    const h0 = sortedGroups[0]![0]!;
    return { level: 'warn', headline: `Atenção: ${WORDS[h0.kind][h0.direction].charAt(0).toLowerCase()}${WORDS[h0.kind][h0.direction].slice(1)}`, details: details.slice(0, 4) };
  }
  if (fresh < total) {
    return { level: 'warn', headline: fresh === 1 ? 'Só 1 sensor funcionando' : `${fresh} de ${total} sensores funcionando`, details: details.slice(0, 4) };
  }
  if (!limitsConfigured(config.alerts)) {
    return { level: 'ok', headline: 'Sensores funcionando', details: ['Defina as faixas ideais em Configurações para o painel avisar quando sair delas.'] };
  }
  return { level: 'ok', headline: 'Tudo certo no orquidário', details: ['Temperatura e umidade dentro das faixas definidas.'] };
}

export interface SimplePump {
  tone: 'on' | 'off' | 'unknown' | 'none';
  label: string;
  detail: string;
}

export function simplePump(p: PumpDto, nowMs: number): SimplePump {
  if (p.comm === 'not_linked') return { tone: 'none', label: 'Bomba não conectada', detail: 'Ainda não ligada ao painel.' };
  if (p.comm === 'ok' && p.state === 'on') return { tone: 'on', label: 'Bomba LIGADA', detail: p.seenAt ? `Confirmado ${formatAge(nowMs - Date.parse(p.seenAt))}` : '' };
  if (p.comm === 'ok' && p.state === 'off') return { tone: 'off', label: 'Bomba conectada', detail: p.seenAt ? `Verificada ${formatAge(nowMs - Date.parse(p.seenAt))}` : '' };
  return { tone: 'unknown', label: 'Bomba sem comunicação', detail: p.comm === 'offline' ? 'O interruptor está fora do ar.' : 'Sem verificação recente do interruptor.' };
}

/** Mínima e máxima de hoje a partir das séries do histórico (bruto: [t, temp, umid, ...]). */
export function todayExtremes(series: { rows: (number | null)[][] }[]): { tMin: number | null; tMax: number | null; hMin: number | null; hMax: number | null } {
  let tMin: number | null = null;
  let tMax: number | null = null;
  let hMin: number | null = null;
  let hMax: number | null = null;
  for (const s of series)
    for (const r of s.rows) {
      const t = r[1];
      const h = r[2];
      if (typeof t === 'number') {
        tMin = tMin === null ? t : Math.min(tMin, t);
        tMax = tMax === null ? t : Math.max(tMax, t);
      }
      if (typeof h === 'number') {
        hMin = hMin === null ? h : Math.min(hMin, h);
        hMax = hMax === null ? h : Math.max(hMax, h);
      }
    }
  return { tMin, tMax, hMin, hMax };
}

export interface Trend {
  dir: 'up' | 'down' | 'flat';
  /** Variação por hora (unidade da grandeza). */
  perHour: number;
}

/**
 * Tendência pela média dos sensores: último ponto contra o ponto mais próximo de 1 h antes (precisa de pelo menos
 * 40 min de diferença e de um último ponto com menos de 45 min). Abaixo de `threshold` por hora = estável.
 */
export function trendOf(points: { t: number; v: number }[], threshold: number, nowMs: number): Trend | null {
  if (points.length < 2) return null;
  const last = points[points.length - 1]!;
  if (nowMs - last.t > 45 * 60_000) return null;
  const target = last.t - 60 * 60_000;
  let best: { t: number; v: number } | null = null;
  for (const p of points) {
    if (last.t - p.t < 40 * 60_000) continue;
    if (!best || Math.abs(p.t - target) < Math.abs(best.t - target)) best = p;
  }
  if (!best) return null;
  const perHour = (last.v - best.v) / ((last.t - best.t) / 3_600_000);
  return { dir: perHour >= threshold ? 'up' : perHour <= -threshold ? 'down' : 'flat', perHour };
}
