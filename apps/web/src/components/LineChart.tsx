import { useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { DAY, HOUR, downsampleForChart, fmtNum, formatDateTime, formatDayMonth, formatTime, startOfLocalDay } from '@orq/core';
import type { IrrigationPeriod } from '@orq/core';

export interface ChartPoint {
  t: number;
  v: number;
  /** Mínimo/máximo dentro do intervalo (agregado horário). */
  lo?: number;
  hi?: number;
}
export interface ChartSeries {
  id: string;
  name: string;
  color: string;
  points: ChartPoint[];
}

interface Props {
  series: ChartSeries[];
  from: number;
  to: number;
  unit: string;
  digits?: number;
  irrigation?: IrrigationPeriod[];
  /** Intervalo acima do qual a linha é interrompida (sem preencher períodos sem dados). */
  gapMs: number;
  limits?: { min: number | null; max: number | null };
  height?: number;
  nowMs: number;
  minSpan?: number;
  label: string;
}

const M = { l: 46, r: 12, t: 20, b: 24 };

function niceStep(span: number, target = 5): number {
  const raw = span / target;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const f = raw / pow;
  return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * pow;
}

function xTicks(from: number, to: number): { t: number; label: string }[] {
  const span = to - from;
  const steps = [HOUR, 2 * HOUR, 3 * HOUR, 6 * HOUR, 12 * HOUR, DAY, 2 * DAY, 7 * DAY];
  const step = steps.find((s) => span / s <= 8) ?? 7 * DAY;
  const out: { t: number; label: string }[] = [];
  let t = startOfLocalDay(from);
  while (t < from) t += step;
  for (; t <= to; t += step) {
    const atMidnight = t === startOfLocalDay(t);
    out.push({ t, label: step >= DAY ? formatDayMonth(t) : atMidnight ? `${formatDayMonth(t)}` : formatTime(t) });
  }
  return out;
}

export function LineChart({ series, from, to, unit, digits = 1, irrigation = [], gapMs, limits, height = 230, nowMs, minSpan = 2, label }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const [hover, setHover] = useState<{ x: number; t: number } | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(Math.max(280, el.clientWidth)));
    ro.observe(el);
    setWidth(Math.max(280, el.clientWidth));
    return () => ro.disconnect();
  }, []);

  const drawn = useMemo(() => series.map((s) => ({ ...s, points: downsampleForChart(s.points, (p) => p.v, 900) })), [series]);

  const { yMin, yMax, ticks, step } = useMemo(() => {
    let lo = Infinity;
    let hi = -Infinity;
    for (const s of drawn) for (const p of s.points) {
      lo = Math.min(lo, p.lo ?? p.v);
      hi = Math.max(hi, p.hi ?? p.v);
    }
    if (!Number.isFinite(lo)) return { yMin: 0, yMax: 1, ticks: [0, 1], step: 1 };
    if (hi - lo < minSpan) {
      const c = (hi + lo) / 2;
      lo = c - minSpan / 2;
      hi = c + minSpan / 2;
    }
    const pad = (hi - lo) * 0.08;
    lo -= pad;
    hi += pad;
    const step = niceStep(hi - lo);
    const a = Math.floor(lo / step) * step;
    const b = Math.ceil(hi / step) * step;
    const t: number[] = [];
    for (let v = a; v <= b + 1e-9; v += step) t.push(Math.round(v * 1000) / 1000);
    return { yMin: a, yMax: b, ticks: t, step };
  }, [drawn, minSpan]);

  const W = width;
  const H = height;
  const iw = W - M.l - M.r;
  const ih = H - M.t - M.b;
  const x = (t: number) => M.l + ((t - from) / (to - from)) * iw;
  const y = (v: number) => M.t + (1 - (v - yMin) / (yMax - yMin || 1)) * ih;
  const xt = useMemo(() => xTicks(from, to), [from, to]);

  const paths = drawn.map((s) => {
    const segs: ChartPoint[][] = [];
    let cur: ChartPoint[] = [];
    let prev: ChartPoint | null = null;
    for (const p of s.points) {
      if (p.t < from || p.t > to) continue;
      if (prev && p.t - prev.t > gapMs) {
        if (cur.length) segs.push(cur);
        cur = [];
      }
      cur.push(p);
      prev = p;
    }
    if (cur.length) segs.push(cur);
    const line = segs.map((seg) => seg.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)} ${y(p.v).toFixed(1)}`).join(' ')).join(' ');
    const band = segs
      .filter((seg) => seg.length > 1 && seg.some((p) => p.lo !== undefined))
      .map((seg) => {
        const up = seg.map((p) => `${x(p.t).toFixed(1)} ${y(p.hi ?? p.v).toFixed(1)}`);
        const dn = [...seg].reverse().map((p) => `${x(p.t).toFixed(1)} ${y(p.lo ?? p.v).toFixed(1)}`);
        return `M${up.join(' L')} L${dn.join(' L')} Z`;
      })
      .join(' ');
    const singles = segs.filter((seg) => seg.length === 1).map((seg) => seg[0]!);
    return { id: s.id, color: s.color, line, band, singles };
  });

  const onMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    if (px < M.l || px > W - M.r) return setHover(null);
    setHover({ x: px, t: from + ((px - M.l) / iw) * (to - from) });
  };

  const near = hover
    ? drawn.map((s) => {
        let best: ChartPoint | null = null;
        let bd = Infinity;
        for (const p of s.points) {
          const d = Math.abs(p.t - hover.t);
          if (d < bd) {
            bd = d;
            best = p;
          }
        }
        return { s, p: best && bd <= Math.max(gapMs, ((to - from) / iw) * 12) ? best : null };
      })
    : [];

  const irrBands = irrigation
    .map((p) => ({ a: Math.max(from, p.startedAt), b: Math.min(to, p.endedAt ?? nowMs) }))
    .filter((p) => p.b > p.a);

  return (
    <div className="chart" ref={wrapRef}>
      <svg width={W} height={H} role="img" aria-label={label} onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
        {ticks.map((v) => (
          <g key={v}>
            <line className="grid" x1={M.l} x2={W - M.r} y1={y(v)} y2={y(v)} />
            <text className="axis-label" x={M.l - 6} y={y(v) + 4} textAnchor="end">
              {fmtNum(v, step >= 1 ? 0 : step >= 0.1 ? 1 : 2)}
            </text>
          </g>
        ))}
        {irrBands.map((b, i) => (
          <rect key={i} className="irr-band" x={x(b.a)} y={M.t} width={Math.max(2, x(b.b) - x(b.a))} height={ih} />
        ))}
        {limits?.min != null && limits.min >= yMin && limits.min <= yMax && <line className="limit" x1={M.l} x2={W - M.r} y1={y(limits.min)} y2={y(limits.min)} />}
        {limits?.max != null && limits.max >= yMin && limits.max <= yMax && <line className="limit" x1={M.l} x2={W - M.r} y1={y(limits.max)} y2={y(limits.max)} />}
        {xt.map(({ t, label: lbl }) => (
          <g key={t}>
            <line className="grid" x1={x(t)} x2={x(t)} y1={M.t} y2={M.t + ih} style={{ opacity: 0.5 }} />
            <text className="axis-label" x={x(t)} y={H - 6} textAnchor="middle">
              {lbl}
            </text>
          </g>
        ))}
        <text className="axis-label" x={4} y={11} textAnchor="start" style={{ fontWeight: 700 }}>
          {unit}
        </text>
        {paths.map((p) => (
          <g key={p.id}>
            {p.band && <path d={p.band} fill={p.color} opacity={0.14} />}
            <path d={p.line} fill="none" stroke={p.color} strokeWidth={1.8} strokeLinejoin="round" strokeLinecap="round" />
            {p.singles.map((pt) => (
              <circle key={pt.t} cx={x(pt.t)} cy={y(pt.v)} r={2.2} fill={p.color} />
            ))}
          </g>
        ))}
        {hover && <line x1={hover.x} x2={hover.x} y1={M.t} y2={M.t + ih} stroke="#a3b8be" strokeDasharray="3 3" />}
        {hover && near.map(({ s, p }) => p && <circle key={s.id} cx={x(p.t)} cy={y(p.v)} r={3.5} fill={s.color} stroke="#070d11" strokeWidth={1.5} />)}
      </svg>
      {hover && (
        <div className="chart__tip" style={{ left: Math.min(hover.x + 12, W - 190), top: 8 }}>
          <div className="dim">{formatDateTime(hover.t)}</div>
          {near.map(({ s, p }) => (
            <div key={s.id}>
              <span style={{ color: s.color }}>●</span> {s.name}: <b>{p ? `${fmtNum(p.v, digits)} ${unit}` : 'sem dados'}</b>
              {p?.lo !== undefined && p.hi !== undefined && (
                <span className="mute">
                  {' '}
                  ({fmtNum(p.lo, digits)}–{fmtNum(p.hi, digits)})
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
