/**
 * Clima da cidade pelo Open-Meteo (gratuito, sem chave). Consulta no máximo a cada 15 min por local; se o serviço
 * falhar, devolve o último dado guardado marcado como desatualizado — nunca inventa previsão.
 */
import { WEATHER_TTL_MS, iso, openMeteoForecastUrl, openMeteoGeocodeUrl, parseOpenMeteoForecast, parseOpenMeteoGeocode } from '@orq/core';
import type { AppConfig, GeoPlace, WeatherData, WeatherResponse } from '@orq/core';
import type { D1Database } from '@cloudflare/workers-types';
import { HttpError } from './http';

const TIMEOUT_MS = 8000;

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`Open-Meteo respondeu ${res.status}`);
  return res.json();
}

const placeKey = (lat: number, lon: number) => `${lat.toFixed(3)},${lon.toFixed(3)}`;

export async function weatherFor(db: D1Database, config: AppConfig, now: number): Promise<WeatherResponse> {
  const loc = config.location;
  if (!loc) return { configured: false, place: null, data: null, fetchedAt: null, stale: false, error: null };
  const key = placeKey(loc.lat, loc.lon);
  const row = await db.prepare('SELECT fetched_at, payload FROM weather_cache WHERE place_key = ?').bind(key).first<{ fetched_at: number; payload: string }>();
  if (row && now - row.fetched_at < WEATHER_TTL_MS) {
    return { configured: true, place: loc.name, data: JSON.parse(row.payload) as WeatherData, fetchedAt: iso(row.fetched_at), stale: false, error: null };
  }
  try {
    const data = parseOpenMeteoForecast(await getJson(openMeteoForecastUrl(loc.lat, loc.lon)));
    await db
      .prepare('INSERT INTO weather_cache (place_key, fetched_at, payload) VALUES (?, ?, ?) ON CONFLICT(place_key) DO UPDATE SET fetched_at = excluded.fetched_at, payload = excluded.payload')
      .bind(key, now, JSON.stringify(data))
      .run();
    return { configured: true, place: loc.name, data, fetchedAt: iso(now), stale: false, error: null };
  } catch (e) {
    const error = `Não foi possível consultar a previsão (${(e as Error).message}).`;
    if (row) return { configured: true, place: loc.name, data: JSON.parse(row.payload) as WeatherData, fetchedAt: iso(row.fetched_at), stale: true, error };
    return { configured: true, place: loc.name, data: null, fetchedAt: null, stale: true, error };
  }
}

export async function geocode(q: string): Promise<GeoPlace[]> {
  const name = q.trim();
  if (name.length < 2 || name.length > 80) throw new HttpError(400, 'invalid_query', 'Digite de 2 a 80 caracteres.');
  try {
    return parseOpenMeteoGeocode(await getJson(openMeteoGeocodeUrl(name)));
  } catch {
    throw new HttpError(502, 'geocode_failed', 'Não foi possível buscar a cidade agora. Tente de novo em instantes.');
  }
}
