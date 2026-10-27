/**
 * "O que fazer": leitura das médias por hora da semana e recomendações simples de manejo para temperatura e
 * umidade. Regras explícitas (sem "caixa-preta"); sair da faixa por pouco tempo não é tratado como problema.
 */
import { activeAlerts, isNight } from './simple';
import type { AppConfig, Bucket } from './types';

export interface Insight {
  level: 'ok' | 'atencao';
  title: string;
  action: string;
}

const hourOf = (ms: number) => Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Sao_Paulo', hour: '2-digit', hourCycle: 'h23' }).format(ms));
const MIN_HOURS = 3;

/** Hora do dia (0–23) que mais aparece numa lista de instantes. */
function typicalHours(ts: number[]): [number, number] | null {
  if (!ts.length) return null;
  const c = new Array(24).fill(0) as number[];
  for (const t of ts) c[hourOf(t)]!++;
  const max = Math.max(...c);
  const top = c.map((n, h) => ({ n, h })).filter((x) => x.n >= max / 2).map((x) => x.h);
  return [top[0]!, top[top.length - 1]!];
}

export function weeklyInsights(buckets: Bucket[], config: Pick<AppConfig, 'alerts' | 'nightTemperature' | 'sensors'>): Insight[] {
  const out: Insight[] = [];
  if (buckets.length === 0) return out;
  // média dos sensores em cada hora
  const byHour = new Map<number, { t: number[]; h: number[] }>();
  for (const b of buckets) {
    const e = byHour.get(b.t) ?? { t: [], h: [] };
    e.t.push(b.tAvg);
    e.h.push(b.hAvg);
    byHour.set(b.t, e);
  }
  const hours = [...byHour].map(([t, e]) => ({ t, temp: e.t.reduce((a, x) => a + x, 0) / e.t.length, hum: e.h.reduce((a, x) => a + x, 0) / e.h.length }));
  const fmtH = (r: [number, number] | null) => (r ? (r[0] === r[1] ? `por volta das ${r[0]}h` : `entre ${r[0]}h e ${r[1] + 1}h`) : '');

  const hot: number[] = [];
  const coldNight: number[] = [];
  const hotNight: number[] = [];
  const dry: number[] = [];
  const wetNight: number[] = [];
  for (const x of hours) {
    const lim = activeAlerts(config, x.t);
    const night = isNight(config, x.t);
    if (lim.temperature.max !== null && x.temp > lim.temperature.max) (night ? hotNight : hot).push(x.t);
    if (lim.temperature.min !== null && x.temp < lim.temperature.min && night) coldNight.push(x.t);
    if (lim.humidity.min !== null && x.hum < lim.humidity.min) dry.push(x.t);
    if (lim.humidity.max !== null && x.hum > lim.humidity.max && night) wetNight.push(x.t);
  }
  const days = Math.max(1, Math.round(hours.length / 24));
  const perDay = (n: number) => (days > 1 ? ` (≈ ${Math.round(n / days)} h por dia)` : '');

  if (hot.length >= MIN_HOURS)
    out.push({ level: 'atencao', title: `Calor de dia: ${hot.length} h acima da faixa${perDay(hot.length)}, ${fmtH(typicalHours(hot))}`, action: 'Reforçar sombreamento e ventilação nesse horário; uma nebulização curta antes do pico ajuda a segurar a temperatura.' });
  if (coldNight.length >= MIN_HOURS)
    out.push({ level: 'atencao', title: `Noites frias: ${coldNight.length} h abaixo da faixa${perDay(coldNight.length)}, ${fmtH(typicalHours(coldNight))}`, action: 'Fechar laterais/cortinas ao entardecer e evitar irrigar no fim da tarde (planta molhada à noite esfria mais).' });
  if (hotNight.length >= MIN_HOURS)
    out.push({ level: 'atencao', title: `Noites quentes: ${hotNight.length} h acima da faixa da noite`, action: 'Abrir laterais à noite para a temperatura cair; a diferença dia/noite favorece a floração.' });
  if (dry.length >= MIN_HOURS) {
    const r = typicalHours(dry);
    out.push({ level: 'atencao', title: `Ar seco: ${dry.length} h abaixo da umidade mínima${perDay(dry.length)}, ${fmtH(r)}`, action: r ? `Programar uma irrigação curta por volta das ${Math.max(0, r[0] - 1)}h (antes do período seco), se as regras de sol permitirem; molhar o piso também eleva a umidade.` : 'Aumentar irrigação/nebulização no período seco.' });
  }
  if (wetNight.length >= 6)
    out.push({ level: 'atencao', title: `Umidade alta à noite: ${wetNight.length} h acima da máxima`, action: 'Risco de fungos: manter o ar circulando à noite e não molhar depois das 16h.' });

  // diferença entre pontos (ex.: perto da saída, mais luz e ventilação)
  const per = new Map<string, { t: number[]; h: number[] }>();
  for (const b of buckets) {
    const e = per.get(b.sensorId) ?? { t: [], h: [] };
    e.t.push(b.tAvg);
    e.h.push(b.hAvg);
    per.set(b.sensorId, e);
  }
  const avg = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;
  const stats = [...per].map(([id, e]) => ({ id, t: avg(e.t), h: avg(e.h) }));
  if (stats.length >= 2) {
    const name = (id: string) => config.sensors.find((s) => s.id === id)?.name ?? id;
    const meanT = avg(stats.map((s) => s.t));
    const meanH = avg(stats.map((s) => s.h));
    const odd = stats.reduce((a, b) => (Math.abs(b.t - meanT) > Math.abs(a.t - meanT) ? b : a));
    const dT = odd.t - avg(stats.filter((s) => s.id !== odd.id).map((s) => s.t));
    const dH = odd.h - avg(stats.filter((s) => s.id !== odd.id).map((s) => s.h));
    if (Math.abs(dT) >= 1 || Math.abs(dH) >= 5)
      out.push({
        level: 'atencao',
        title: `${name(odd.id)} difere dos outros pontos: ${dT >= 0 ? '+' : ''}${dT.toFixed(1).replace('.', ',')} °C e ${dH >= 0 ? '+' : ''}${Math.round(dH)} pontos de umidade (média da semana)`,
        action: dT > 0 ? 'Ponto mais quente/claro: se as plantas dali estão melhores, vale testar sombrite mais aberto no resto; se piores, sombrear mais esse ponto.' : 'Ponto mais fresco: confira se há corrente de ar forte ou sombra excessiva ali.',
      });
    else if (meanT || meanH) out.push({ level: 'ok', title: 'Temperatura e umidade parecidas em todos os pontos', action: 'A estufa está homogênea; diferenças de manejo entre pontos não devem ser necessárias.' });
  }
  if (!out.some((x) => x.level === 'atencao')) out.unshift({ level: 'ok', title: 'Semana dentro das faixas', action: 'Manter o manejo atual.' });
  return out;
}
