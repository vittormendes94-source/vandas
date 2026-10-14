/** Datas armazenadas em UTC; apresentação e entradas de formulário em America/Sao_Paulo. */

export const APP_TZ = 'America/Sao_Paulo';
export const MIN = 60_000;
export const HOUR = 3_600_000;
export const DAY = 86_400_000;

const partsFmt = new Map<string, Intl.DateTimeFormat>();
function fmtFor(tz: string): Intl.DateTimeFormat {
  let f = partsFmt.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    partsFmt.set(tz, f);
  }
  return f;
}

export interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export function localParts(utcMs: number, tz = APP_TZ): LocalParts {
  const out: Record<string, number> = {};
  for (const p of fmtFor(tz).formatToParts(new Date(utcMs))) {
    if (p.type !== 'literal') out[p.type] = Number(p.value);
  }
  return {
    year: out.year!,
    month: out.month!,
    day: out.day!,
    hour: out.hour!,
    minute: out.minute!,
    second: out.second!,
  };
}

/** Deslocamento (local − UTC) em ms no instante dado. */
export function tzOffsetMs(utcMs: number, tz = APP_TZ): number {
  const p = localParts(utcMs, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

/** Converte um horário de parede local em instante UTC (ms). */
export function zonedToUtc(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  tz = APP_TZ,
): number {
  const naive = Date.UTC(year, month - 1, day, hour, minute, 0);
  let guess = naive - tzOffsetMs(naive, tz);
  guess = naive - tzOffsetMs(guess, tz);
  return guess;
}

/** "YYYY-MM-DDTHH:mm" (valor de <input type="datetime-local">) → UTC ms. null se inválido. */
export function localInputToUtc(value: string, tz = APP_TZ): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m.map(Number) as [number, number, number, number, number, number];
  return zonedToUtc(y, mo, d, h, mi, tz);
}

export function utcToLocalInput(utcMs: number, tz = APP_TZ): string {
  const p = localParts(utcMs, tz);
  const z = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${z(p.year, 4)}-${z(p.month)}-${z(p.day)}T${z(p.hour)}:${z(p.minute)}`;
}

/** Hora local decimal (0–24) no instante. */
export function localHourDecimal(utcMs: number, tz = APP_TZ): number {
  const p = localParts(utcMs, tz);
  return p.hour + p.minute / 60 + p.second / 3600;
}

export function startOfLocalDay(utcMs: number, tz = APP_TZ): number {
  const p = localParts(utcMs, tz);
  return zonedToUtc(p.year, p.month, p.day, 0, 0, tz);
}

const dtCache = new Map<string, Intl.DateTimeFormat>();
function intl(key: string, opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  let f = dtCache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat('pt-BR', { timeZone: APP_TZ, ...opts });
    dtCache.set(key, f);
  }
  return f;
}

/** "30/09/2026 14:05" */
export function formatDateTime(utcMs: number): string {
  return intl('dt', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
    .format(new Date(utcMs))
    .replace(',', '');
}

/** "14:05:33" */
export function formatTimeSec(utcMs: number): string {
  return intl('ts', { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(new Date(utcMs));
}

/** "14:05" */
export function formatTime(utcMs: number): string {
  return intl('t', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(utcMs));
}

/** "30/09" */
export function formatDayMonth(utcMs: number): string {
  return intl('dm', { day: '2-digit', month: '2-digit' }).format(new Date(utcMs));
}

/** "ter., 30/09" */
export function formatWeekdayDay(utcMs: number): string {
  return intl('wd', { weekday: 'short', day: '2-digit', month: '2-digit' }).format(new Date(utcMs));
}

/** "há 3 min", "há 2 h 05 min", "há 3 d". */
export function formatAge(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return '—';
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 45) return 'agora há pouco';
  const min = Math.floor(s / 60);
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h} h ${String(min % 60).padStart(2, '0')} min`;
  return `há ${Math.floor(h / 24)} d ${h % 24} h`;
}

/** "5 min", "1 h 30 min". */
export function formatDuration(ms: number): string {
  const min = Math.round(ms / MIN);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const r = min % 60;
  if (h < 24) return r ? `${h} h ${r} min` : `${h} h`;
  const d = Math.floor(h / 24);
  return `${d} d ${h % 24} h`;
}

/** Formata número em pt-BR com casas fixas: 28,3. */
export function fmtNum(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return v.toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
