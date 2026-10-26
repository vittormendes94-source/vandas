import { useEffect, useMemo, useRef, useState } from 'react';
import { ROOM, buildProjection, colorAt, colorBand, conditionStops, contourLevels, contourSegments, contourStep, fmtNum } from '@orq/core';
import type { AppConfig, Quantity, Snapshot } from '@orq/core';

const COLS = 96;
const ROWS = 40;
const UNIT: Record<Quantity, { suffix: string; digits: number }> = {
  temperature: { suffix: '°', digits: 1 },
  humidity: { suffix: '%', digits: 0 },
};

/**
 * Mapa da Visão TV: projeção para a estufa inteira a partir dos sensores atualizados (tendência + correção por
 * distância, ver core/heatmap.ts), cores pela faixa ideal e isolinhas com o valor.
 */
export function SmartMap({ quantity, snapshot, config, pumpOn }: { quantity: Quantity; snapshot: Snapshot; config: AppConfig; pumpOn: boolean }) {
  const u = UNIT[quantity];
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const band = colorBand(quantity, config.alerts[quantity]);
  const stops = useMemo(() => conditionStops(quantity, band), [quantity, band.min, band.max]); // eslint-disable-line react-hooks/exhaustive-deps
  const points = useMemo(
    () =>
      snapshot.sensors
        .filter((s) => s.valid && s.reading)
        .map((s) => ({ x: s.sensor.xM, y: s.sensor.yM, v: quantity === 'temperature' ? s.reading!.temperatureC : s.reading!.humidityPct })),
    [snapshot, quantity],
  );
  const field = useMemo(() => buildProjection(points, ROOM.lengthM, ROOM.widthM, COLS, ROWS), [points]);
  const pins = useMemo(() => snapshot.sensors.map((s) => ({ x: s.sensor.xM, y: s.sensor.yM })), [snapshot]);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || size.w === 0) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(size.w * dpr);
    canvas.height = Math.round(size.h * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const { w: W, h: H } = size;
    ctx.clearRect(0, 0, W, H);
    if (!field) return;

    const off = document.createElement('canvas');
    off.width = COLS;
    off.height = ROWS;
    const octx = off.getContext('2d')!;
    const img = octx.createImageData(COLS, ROWS);
    for (let i = 0; i < COLS * ROWS; i++) {
      const [r, g, b] = colorAt(stops, field.values[i]!);
      img.data[i * 4] = r;
      img.data[i * 4 + 1] = g;
      img.data[i * 4 + 2] = b;
      img.data[i * 4 + 3] = 235;
    }
    octx.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(off, 0, 0, W, H);
    // leve sombreamento para dar profundidade e destacar os rótulos
    const shade = ctx.createLinearGradient(0, 0, 0, H);
    shade.addColorStop(0, 'rgba(0,0,0,0)');
    shade.addColorStop(1, 'rgba(0,0,0,0.18)');
    ctx.fillStyle = shade;
    ctx.fillRect(0, 0, W, H);

    // isolinhas com o valor
    let lo = Infinity;
    let hi = -Infinity;
    for (const v of field.values) {
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
    const step = contourStep(quantity, lo, hi);
    const px = (gx: number) => ((gx + 0.5) / COLS) * W;
    const py = (gy: number) => ((gy + 0.5) / ROWS) * H;
    const fontPx = Math.max(11, Math.round(H * 0.075));
    ctx.font = `600 ${fontPx}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const avoid: (readonly [number, number])[] = pins.map((p) => [(p.x / ROOM.lengthM) * W, (p.y / ROOM.widthM) * H] as const);
    if (pumpOn) avoid.push([W / 2, H * 0.12], [W * 0.4, H * 0.12], [W * 0.6, H * 0.12]); // selo "Irrigando agora"
    for (const level of contourLevels(lo, hi, step)) {
      const segs = contourSegments(field.values, COLS, ROWS, level);
      if (segs.length === 0) continue;
      ctx.strokeStyle = 'rgba(10, 20, 26, 0.45)';
      ctx.lineWidth = Math.max(1, H * 0.006);
      ctx.setLineDash([]);
      ctx.beginPath();
      for (const [x1, y1, x2, y2] of segs) {
        ctx.moveTo(px(x1), py(y1));
        ctx.lineTo(px(x2), py(y2));
      }
      ctx.stroke();
      // rótulo no trecho mais longe dos sensores e dos outros rótulos (sem cobrir nada)
      const mids = segs.map(([x1, y1, x2, y2]) => [(px(x1) + px(x2)) / 2, (py(y1) + py(y2)) / 2] as const).filter(([x, y]) => x > W * 0.06 && x < W * 0.94 && y > H * 0.1 && y < H * 0.9);
      if (mids.length === 0) continue;
      const clearance = (p: readonly [number, number]) => Math.min(...avoid.map((a) => Math.hypot(p[0] - a[0], (p[1] - a[1]) * 1.6)));
      const m = mids.reduce((b, p) => (clearance(p) > clearance(b) ? p : b));
      avoid.push(m);
      const text = `${fmtNum(level, step < 1 ? 1 : 0)}${u.suffix}`;
      const tw = ctx.measureText(text).width + fontPx * 0.6;
      ctx.fillStyle = 'rgba(10, 20, 26, 0.6)';
      ctx.beginPath();
      // roundRect não existe em navegadores de TV mais antigos
      if (typeof ctx.roundRect === 'function') ctx.roundRect(m[0] - tw / 2, m[1] - fontPx * 0.7, tw, fontPx * 1.4, fontPx * 0.4);
      else ctx.rect(m[0] - tw / 2, m[1] - fontPx * 0.7, tw, fontPx * 1.4);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      ctx.fillText(text, m[0], m[1] + 1);
    }
  }, [field, size, stops, quantity, u.suffix, pins, pumpOn]);

  const valid = snapshot.sensors.filter((s) => s.valid && s.reading);
  const vals = valid.map((s) => ({ name: s.sensor.name, v: quantity === 'temperature' ? s.reading!.temperatureC : s.reading!.humidityPct }));
  const hiS = vals.length >= 2 ? vals.reduce((a, b) => (b.v > a.v ? b : a)) : null;
  const loS = vals.length >= 2 ? vals.reduce((a, b) => (b.v < a.v ? b : a)) : null;

  return (
    <>
      <div className="tvp__map-fit">
      <div className="tvp__map" ref={stageRef}>
        <canvas ref={canvasRef} role="img" aria-label={`Projeção de ${quantity === 'temperature' ? 'temperatura' : 'umidade'} para a estufa inteira`} />
        {pumpOn && (
          <svg className="tvp__spr tvp__spr--on" viewBox={`0 0 ${ROOM.lengthM} ${ROOM.widthM}`} preserveAspectRatio="none" aria-hidden="true">
            {config.irrigation.sprinklers.map((s) => (
              <g key={s.id}>
                <circle className="tvp__spr-area" cx={s.xM} cy={s.yM} r={s.radiusM} vectorEffect="non-scaling-stroke" />
                <circle className="tvp__spr-head" cx={s.xM} cy={s.yM} r={0.14} vectorEffect="non-scaling-stroke" />
              </g>
            ))}
          </svg>
        )}
        {snapshot.sensors.map((s) => {
          const v = quantity === 'temperature' ? s.reading?.temperatureC : s.reading?.humidityPct;
          const state = s.valid && v !== undefined ? 'ok' : s.ageMs === null ? 'wait' : 'lost';
          return (
            <div key={s.sensor.id} className={`tvp__pin tvp__pin--${state}`} style={{ left: `${(s.sensor.xM / ROOM.lengthM) * 100}%`, top: `${(s.sensor.yM / ROOM.widthM) * 100}%` }}>
              <b>{state === 'ok' ? `${fmtNum(v!, u.digits)}${u.suffix}` : state === 'wait' ? 'aguardando' : 'sem sinal'}</b>
              <small>{s.sensor.name}</small>
            </div>
          );
        })}
        {pumpOn && <div className="tvp__map-flag tvp__map-flag--on">Irrigando agora</div>}
      </div>
      </div>
      <Legend quantity={quantity} band={band} stops={stops} values={vals.map((x) => x.v)} />
      {hiS && loS && hiS.v - loS.v > 0 && (
        <div className="tvp__insight">
          <b>{hiS.name}</b> {fmtNum(hiS.v - loS.v, u.digits)}
          {quantity === 'temperature' ? '° mais quente' : ' pontos mais úmido'} que <b>{loS.name}</b>
        </div>
      )}
    </>
  );
}

/** Barra de cores com a faixa ideal destacada e a posição de cada sensor. */
function Legend({ quantity, band, stops, values }: { quantity: Quantity; band: { min: number; max: number; fromOwner: boolean }; stops: ReturnType<typeof conditionStops>; values: number[] }) {
  const u = UNIT[quantity];
  const pad = quantity === 'temperature' ? 6 : 20;
  let lo = band.min - pad;
  let hi = band.max + (quantity === 'temperature' ? 6 : 10);
  for (const v of values) {
    lo = Math.min(lo, v - 1);
    hi = Math.max(hi, v + 1);
  }
  if (quantity === 'humidity') {
    lo = Math.max(0, lo);
    hi = Math.min(100, hi);
  }
  const pos = (v: number) => `${((v - lo) / (hi - lo)) * 100}%`;
  const N = 24;
  const gradient = `linear-gradient(90deg, ${Array.from({ length: N + 1 }, (_, i) => {
    const [r, g, b] = colorAt(stops, lo + ((hi - lo) * i) / N);
    return `rgb(${r | 0},${g | 0},${b | 0}) ${(i / N) * 100}%`;
  }).join(', ')})`;
  const words = quantity === 'temperature' ? ['frio', 'ideal', 'quente'] : ['seco', 'ideal', 'saturado'];
  return (
    <div className="tvp__legend" aria-label="Legenda de cores">
      <div className="tvp__legend-bar" style={{ background: gradient }}>
        <span className="tvp__legend-band" style={{ left: pos(band.min), width: `calc(${pos(band.max)} - ${pos(band.min)})` }} />
        {values.map((v, i) => (
          <span key={i} className="tvp__legend-mark" style={{ left: pos(v) }} />
        ))}
      </div>
      <div className="tvp__legend-labels">
        <span>{words[0]}</span>
        <span className="tvp__legend-mid" style={{ left: pos((band.min + band.max) / 2) }}>
          {words[1]} {fmtNum(band.min, 0)}–{fmtNum(band.max, 0)}
          {u.suffix}
          {!band.fromOwner && ' (referência)'}
        </span>
        <span>{words[2]}</span>
      </div>
    </div>
  );
}
