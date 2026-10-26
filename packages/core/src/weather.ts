/**
 * Clima da cidade (lá fora): condições atuais e previsão de 7 dias pelo Open-Meteo (gratuito, sem chave, uso
 * não comercial). É PREVISÃO/MODELO para a cidade, não medição no orquidário: a interface sempre diz isso.
 */
import { z } from 'zod';

export interface PlaceConfig {
  name: string;
  lat: number;
  lon: number;
}

export const PlaceSchema = z.strictObject({
  name: z.string().trim().min(1).max(120),
  lat: z.number().finite().min(-90).max(90),
  lon: z.number().finite().min(-180).max(180),
});

export const WEATHER_TZ = 'America/Sao_Paulo';
/** Atualiza no máximo a cada 15 min (o Open-Meteo atualiza as condições atuais a cada 15 min). */
export const WEATHER_TTL_MS = 15 * 60_000;

export function openMeteoForecastUrl(lat: number, lon: number): string {
  const q = new URLSearchParams({
    latitude: lat.toFixed(4),
    longitude: lon.toFixed(4),
    current: 'temperature_2m,relative_humidity_2m,precipitation,weather_code,is_day,direct_radiation',
    hourly: 'temperature_2m,direct_radiation,precipitation_probability',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max',
    timezone: WEATHER_TZ,
    forecast_days: '7',
  });
  return `https://api.open-meteo.com/v1/forecast?${q}`;
}

export function openMeteoGeocodeUrl(name: string): string {
  const q = new URLSearchParams({ name, count: '8', language: 'pt', format: 'json' });
  return `https://geocoding-api.open-meteo.com/v1/search?${q}`;
}

export interface WeatherDay {
  /** AAAA-MM-DD no fuso de São Paulo. */
  date: string;
  code: number;
  tMax: number | null;
  tMin: number | null;
  rainMm: number | null;
  /** Probabilidade máxima de chuva no dia (%). */
  rainProb: number | null;
}

export interface WeatherHour {
  /** Horário local (AAAA-MM-DDTHH:MM, São Paulo). */
  time: string;
  temperatureC: number | null;
  /** Radiação solar direta (W/m², média da hora anterior). */
  directRadiationWm2: number | null;
  rainProb: number | null;
}

export interface WeatherNow {
  /** Horário local da condição (AAAA-MM-DDTHH:MM, São Paulo). */
  time: string;
  temperatureC: number;
  humidityPct: number;
  precipitationMm: number;
  code: number;
  isDay: boolean;
  /** Radiação solar direta estimada para a cidade (W/m²). null = não informada. */
  directRadiationWm2: number | null;
}

export interface WeatherData {
  current: WeatherNow;
  days: WeatherDay[];
  /** Previsão hora a hora (pode faltar em dados guardados por versões anteriores). */
  hours?: WeatherHour[];
}

export interface WeatherResponse {
  configured: boolean;
  place: string | null;
  data: WeatherData | null;
  /** Quando o servidor buscou os dados (ISO UTC). */
  fetchedAt: string | null;
  /** true = a última tentativa falhou e estes são os dados guardados anteriormente. */
  stale: boolean;
  error: string | null;
}

const num = z.number().finite();
const nullableNums = z.array(num.nullable());
const ForecastSchema = z.object({
  current: z.object({
    time: z.string(),
    temperature_2m: num,
    relative_humidity_2m: num,
    precipitation: num.nullable().optional(),
    weather_code: num,
    is_day: num.nullable().optional(),
    direct_radiation: num.nullable().optional(),
  }),
  hourly: z
    .object({
      time: z.array(z.string()),
      temperature_2m: nullableNums.optional(),
      direct_radiation: nullableNums.optional(),
      precipitation_probability: nullableNums.optional(),
    })
    .optional(),
  daily: z.object({
    time: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
    weather_code: nullableNums,
    temperature_2m_max: nullableNums,
    temperature_2m_min: nullableNums,
    precipitation_sum: nullableNums,
    precipitation_probability_max: nullableNums.optional(),
  }),
});

/** Valida e normaliza a resposta do Open-Meteo. Lança erro se faltar o essencial. */
export function parseOpenMeteoForecast(json: unknown): WeatherData {
  const f = ForecastSchema.parse(json);
  const d = f.daily;
  const days: WeatherDay[] = d.time.map((date, i) => ({
    date,
    code: d.weather_code[i] ?? 0,
    tMax: d.temperature_2m_max[i] ?? null,
    tMin: d.temperature_2m_min[i] ?? null,
    rainMm: d.precipitation_sum[i] ?? null,
    rainProb: d.precipitation_probability_max?.[i] ?? null,
  }));
  return {
    current: {
      time: f.current.time,
      temperatureC: f.current.temperature_2m,
      humidityPct: f.current.relative_humidity_2m,
      precipitationMm: f.current.precipitation ?? 0,
      code: f.current.weather_code,
      isDay: f.current.is_day !== 0,
      directRadiationWm2: f.current.direct_radiation ?? null,
    },
    days,
    hours: (f.hourly?.time ?? []).map((time, i) => ({
      time,
      temperatureC: f.hourly?.temperature_2m?.[i] ?? null,
      directRadiationWm2: f.hourly?.direct_radiation?.[i] ?? null,
      rainProb: f.hourly?.precipitation_probability?.[i] ?? null,
    })),
  };
}

export interface GeoPlace extends PlaceConfig {
  /** Ex.: "Uberlândia, Minas Gerais, Brasil". */
  label: string;
}

const GeocodeSchema = z.object({
  results: z
    .array(
      z.object({
        name: z.string(),
        latitude: num,
        longitude: num,
        admin1: z.string().optional(),
        country: z.string().optional(),
      }),
    )
    .optional(),
});

export function parseOpenMeteoGeocode(json: unknown): GeoPlace[] {
  const g = GeocodeSchema.parse(json);
  return (g.results ?? []).map((r) => {
    const label = [r.name, r.admin1, r.country].filter(Boolean).join(', ');
    return { name: [r.name, r.admin1].filter(Boolean).join(', ').slice(0, 120), lat: r.latitude, lon: r.longitude, label };
  });
}

export type WeatherKind = 'clear' | 'partly' | 'cloudy' | 'fog' | 'drizzle' | 'rain' | 'showers' | 'storm';

/** Códigos WMO usados pelo Open-Meteo → tipo de ícone e descrição curta. */
export function weatherKind(code: number): { kind: WeatherKind; label: string } {
  if (code === 0) return { kind: 'clear', label: 'Céu limpo' };
  if (code === 1) return { kind: 'partly', label: 'Poucas nuvens' };
  if (code === 2) return { kind: 'partly', label: 'Parcialmente nublado' };
  if (code === 3) return { kind: 'cloudy', label: 'Nublado' };
  if (code === 45 || code === 48) return { kind: 'fog', label: 'Neblina' };
  if (code >= 51 && code <= 57) return { kind: 'drizzle', label: 'Garoa' };
  if (code >= 61 && code <= 67) return { kind: 'rain', label: code >= 65 ? 'Chuva forte' : 'Chuva' };
  if (code >= 71 && code <= 77) return { kind: 'cloudy', label: 'Neve' };
  if (code >= 80 && code <= 82) return { kind: 'showers', label: code === 82 ? 'Pancadas fortes' : 'Pancadas de chuva' };
  if (code >= 95) return { kind: 'storm', label: 'Tempestade' };
  return { kind: 'cloudy', label: 'Nublado' };
}

const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

/** "Hoje", "Amanhã" ou o dia da semana abreviado, a partir de AAAA-MM-DD (datas de calendário, sem fuso). */
export function weatherDayLabel(date: string, todayDate: string): string {
  if (date === todayDate) return 'Hoje';
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const [ty, tm, td] = todayDate.split('-').map(Number) as [number, number, number];
  const diff = Math.round((Date.UTC(y, m - 1, d) - Date.UTC(ty, tm - 1, td)) / 86_400_000);
  if (diff === 1) return 'Amanhã';
  return WEEKDAYS[new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay()]!;
}

/** Horário local de São Paulo no formato do Open-Meteo (AAAA-MM-DDTHH:MM). */
export function localDateTimeString(ms: number): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: WEATHER_TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(ms)
      .map((x) => [x.type, x.value]),
  );
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

/** Data de hoje (AAAA-MM-DD) em São Paulo. */
export function localDateString(ms: number): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: WEATHER_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(ms);
}
