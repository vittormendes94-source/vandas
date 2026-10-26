import { useEffect, useState } from 'react';
import { fmtNum, localDateString, weatherDayLabel, weatherKind } from '@orq/core';
import type { WeatherKind, WeatherResponse } from '@orq/core';
import { api } from '../lib/api';

/** Clima da cidade: busca ao abrir e a cada 10 min (o servidor guarda por 15 min). */
export function useWeather(): WeatherResponse | null {
  const [w, setW] = useState<WeatherResponse | null>(null);
  useEffect(() => {
    let ac = new AbortController();
    const load = () => {
      ac.abort();
      ac = new AbortController();
      api.weather(ac.signal).then(setW).catch((e: Error) => {
        if (e.name !== 'AbortError') setW((prev) => prev ?? { configured: true, place: null, data: null, fetchedAt: null, stale: true, error: e.message });
      });
    };
    load();
    const id = setInterval(load, 10 * 60_000);
    return () => {
      clearInterval(id);
      ac.abort();
    };
  }, []);
  return w;
}

export function WeatherIcon({ kind, isDay = true, className }: { kind: WeatherKind; isDay?: boolean; className?: string }) {
  const sun = (
    <g>
      <circle cx="12" cy="12" r="4.2" fill="#ffc94a" />
      {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => (
        <line key={a} x1="12" y1="3" x2="12" y2="5.2" stroke="#ffc94a" strokeWidth="1.8" strokeLinecap="round" transform={`rotate(${a} 12 12)`} />
      ))}
    </g>
  );
  const moon = <path d="M15.5 4.5a7.5 7.5 0 1 0 4 12.6A6 6 0 0 1 15.5 4.5z" fill="#cbd6e2" />;
  const cloud = (fill: string, dy = 0) => <path d={`M7 ${19 + dy}h10.5a3.8 3.8 0 0 0 .4-7.6 5.5 5.5 0 0 0-10.6 1.2A3.2 3.2 0 0 0 7 ${19 + dy}z`} fill={fill} />;
  const drops = (n: number, color = '#5ab8ff') =>
    Array.from({ length: n }, (_, i) => <line key={i} x1={8 + i * 3.5} y1="20.5" x2={7 + i * 3.5} y2="23" stroke={color} strokeWidth="1.7" strokeLinecap="round" />);
  let body;
  switch (kind) {
    case 'clear':
      body = isDay ? sun : moon;
      break;
    case 'partly':
      body = (
        <g>
          <g transform="translate(-3 -3) scale(0.85)">{isDay ? sun : moon}</g>
          {cloud('#dfe7ef', 1)}
        </g>
      );
      break;
    case 'cloudy':
      body = cloud('#b9c6d3');
      break;
    case 'fog':
      body = (
        <g stroke="#b9c6d3" strokeWidth="1.8" strokeLinecap="round">
          <line x1="4" y1="9" x2="20" y2="9" />
          <line x1="6" y1="13" x2="18" y2="13" />
          <line x1="4" y1="17" x2="20" y2="17" />
        </g>
      );
      break;
    case 'drizzle':
      body = (
        <g transform="translate(0 -3)">
          {cloud('#b9c6d3')}
          {drops(2)}
        </g>
      );
      break;
    case 'rain':
    case 'showers':
      body = (
        <g transform="translate(0 -3)">
          {cloud(kind === 'showers' ? '#9fb1c2' : '#8fa3b6')}
          {drops(3)}
        </g>
      );
      break;
    case 'storm':
      body = (
        <g transform="translate(0 -3)">
          {cloud('#7d8fa1')}
          <path d="M12.5 18.5l-2.5 4h2.5l-1.5 3.5 4.5-5h-2.6l1.6-2.5z" fill="#ffd34a" />
        </g>
      );
      break;
  }
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      {body}
    </svg>
  );
}

/** "Lá fora agora", para o topo da TV. */
export function OutdoorNow({ w }: { w: WeatherResponse | null }) {
  if (!w || !w.configured || !w.data) return null;
  const c = w.data.current;
  const k = weatherKind(c.code);
  return (
    <div className="tvp__out" title={`Previsão Open-Meteo para ${w.place ?? 'a cidade'}${w.stale ? ' (desatualizada)' : ''}`}>
      <WeatherIcon kind={k.kind} isDay={c.isDay} className="tvp__out-icon" />
      <div>
        <div className="tvp__out-values">
          <b>{fmtNum(c.temperatureC, 0)}°</b>
          <span>{fmtNum(c.humidityPct, 0)}% UR</span>
        </div>
        <div className="tvp__out-label">
          Lá fora · {k.label}
          {c.directRadiationWm2 !== null && c.isDay ? ` · sol ${fmtNum(c.directRadiationWm2, 0)} W/m²` : ''}
          {w.stale ? ' · desatualizado' : ''}
        </div>
      </div>
    </div>
  );
}

/** Previsão de 7 dias (chuva em destaque), para a faixa de baixo da TV. */
export function Forecast({ w, nowMs }: { w: WeatherResponse | null; nowMs: number }) {
  if (!w) return null;
  if (!w.configured) {
    return <section className="tvp__fc tvp__fc--empty">Previsão do tempo: informe a cidade do orquidário em Configurações.</section>;
  }
  if (!w.data) {
    return <section className="tvp__fc tvp__fc--empty">Previsão do tempo indisponível agora. {w.error ?? ''}</section>;
  }
  const today = localDateString(nowMs);
  const days = w.data.days.filter((d) => d.date >= today).slice(0, 7);
  return (
    <section className="tvp__fc" aria-label="Previsão para os próximos 7 dias">
      <div className="tvp__fc-head">
        <div className="tvp__label">Próximos 7 dias</div>
        <div className="tvp__small">
          {w.place} · Open-Meteo{w.stale ? ' · desatualizada' : ''}
        </div>
        <div className="tvp__fc-keys">
          <span className="tvp__fc-key tvp__fc-key--wet">
            <i aria-hidden="true" /> chuva provável
          </span>
          <span className="tvp__fc-key tvp__fc-key--maybe">
            <i aria-hidden="true" /> chuva possível
          </span>
          <span className="tvp__fc-key tvp__fc-key--sun">
            <i aria-hidden="true" /> sol / calor
          </span>
        </div>
      </div>
      <ol className="tvp__fc-days">
        {days.map((d) => {
          const k = weatherKind(d.code);
          // Azul: chuva provável. Laranja claro: dia de sol ou quente (máxima ≥ 30 °C), sem chuva.
          const wet = (d.rainProb ?? 0) >= 60 || (d.rainMm ?? 0) >= 5;
          // Azul-claro: chuva possível (chance ≥ 30% ou ≥ 1 mm).
          const maybe = !wet && ((d.rainProb ?? 0) >= 30 || (d.rainMm ?? 0) >= 1);
          const sunny = !wet && !maybe && (k.kind === 'clear' || k.kind === 'partly' || (d.tMax ?? 0) >= 30);
          return (
            <li key={d.date} className={wet ? 'tvp__fc-wet' : maybe ? 'tvp__fc-maybe' : sunny ? 'tvp__fc-sun' : undefined} title={k.label}>
              <span className="tvp__fc-day">{weatherDayLabel(d.date, today)}</span>
              <WeatherIcon kind={k.kind} className="tvp__fc-icon" />
              <span className="tvp__fc-temp">
                <b>{d.tMax === null ? '–' : `${fmtNum(d.tMax, 0)}°`}</b> {d.tMin === null ? '' : `${fmtNum(d.tMin, 0)}°`}
              </span>
              <span className="tvp__fc-rain">
                {d.rainProb === null ? '' : `${fmtNum(d.rainProb, 0)}%`}
                {d.rainMm !== null && d.rainMm >= 0.5 ? ` · ${fmtNum(d.rainMm, 0)} mm` : ''}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
