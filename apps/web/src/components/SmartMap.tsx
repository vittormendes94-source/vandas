import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ROOM, buildHeatZones, colorAt, fmtNum, heatScale, heatStops } from '@orq/core';
import type { AppConfig, Quantity, Snapshot } from '@orq/core';

const COLS = 96;
const ROWS = 40;
const UNIT: Record<Quantity, { suffix: string; digits: number }> = {
  temperature: { suffix: '°', digits: 1 },
  humidity: { suffix: '%', digits: 0 },
};

/**
 * Mapa da Visão TV no estilo "zona de calor": cada sensor irradia a sua cor e as cores se misturam pela distância
 * (IDW) em toda a estufa. Escala azul → vermelho centrada nos valores medidos (umidade invertida: seco = vermelho).
 */
export function SmartMap({
  quantity,
  snapshot,
  config,
  pumpOn,
  head,
  footer,
}: {
  quantity: Quantity;
  snapshot: Snapshot;
  config: AppConfig;
  pumpOn: boolean;
  head?: ReactNode;
  footer?: ReactNode;
}) {
  const u = UNIT[quantity];
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const points = useMemo(
    () =>
      snapshot.sensors
        .filter((s) => s.valid && s.reading)
        .map((s) => ({ x: s.sensor.xM, y: s.sensor.yM, v: quantity === 'temperature' ? s.reading!.temperatureC : s.reading!.humidityPct })),
    [snapshot, quantity],
  );
  const field = useMemo(() => buildHeatZones(points, ROOM.lengthM, ROOM.widthM, COLS, ROWS), [points]);
  const scale = useMemo(() => heatScale(quantity, points.map((p) => p.v)), [quantity, points]);
  const stops = useMemo(() => heatStops(quantity, scale.lo, scale.hi), [quantity, scale]);

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

    // Croqui em pé, como a estufa: os 12 m na vertical (de cima para baixo) e os 5 m na horizontal.
    const off = document.createElement('canvas');
    off.width = ROWS;
    off.height = COLS;
    const octx = off.getContext('2d')!;
    const img = octx.createImageData(ROWS, COLS);
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < COLS; c++) {
        const [cr, cg, cb] = colorAt(stops, field.values[r * COLS + c]!);
        const k = (c * ROWS + r) * 4;
        img.data[k] = cr;
        img.data[k + 1] = cg;
        img.data[k + 2] = cb;
        img.data[k + 3] = 255;
      }
    octx.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(off, 0, 0, W, H);
    // planta: quadriculado de 1 m, bem leve
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let m = 1; m < ROOM.lengthM; m++) {
      const y = Math.round((m / ROOM.lengthM) * H) + 0.5;
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
    }
    for (let m = 1; m < ROOM.widthM; m++) {
      const x = Math.round((m / ROOM.widthM) * W) + 0.5;
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H);
    }
    ctx.stroke();
  }, [field, size, stops]);

  const valid = snapshot.sensors.filter((s) => s.valid && s.reading);
  const vals = valid.map((s) => ({ name: s.sensor.name, v: quantity === 'temperature' ? s.reading!.temperatureC : s.reading!.humidityPct }));
  const hiS = vals.length >= 2 ? vals.reduce((a, b) => (b.v > a.v ? b : a)) : null;
  const loS = vals.length >= 2 ? vals.reduce((a, b) => (b.v < a.v ? b : a)) : null;

  return (
    <div className="tvp__qv">
      <div className="tvp__vmap" ref={stageRef}>
        <canvas ref={canvasRef} role="img" aria-label={`Projeção de ${quantity === 'temperature' ? 'temperatura' : 'umidade'} para a estufa inteira`} />
        {pumpOn && (
          <svg className="tvp__spr tvp__spr--on" viewBox={`0 0 ${ROOM.widthM} ${ROOM.lengthM}`} preserveAspectRatio="none" aria-hidden="true">
            {config.irrigation.sprinklers.map((s) => (
              <g key={s.id}>
                <circle className="tvp__spr-area" cx={s.yM} cy={s.xM} r={s.radiusM} vectorEffect="non-scaling-stroke" />
                <circle className="tvp__spr-head" cx={s.yM} cy={s.xM} r={0.14} vectorEffect="non-scaling-stroke" />
              </g>
            ))}
          </svg>
        )}
        {snapshot.sensors.map((s) => {
          const v = quantity === 'temperature' ? s.reading?.temperatureC : s.reading?.humidityPct;
          const state = s.valid && v !== undefined ? 'ok' : s.ageMs === null ? 'wait' : 'lost';
          return (
            <div key={s.sensor.id} className={`tvp__pin tvp__pin--${state}`} style={{ left: `${(s.sensor.yM / ROOM.widthM) * 100}%`, top: `${(s.sensor.xM / ROOM.lengthM) * 100}%` }}>
              <b>{state === 'ok' ? `${fmtNum(v!, u.digits)}${u.suffix}` : state === 'wait' ? 'aguardando' : 'sem sinal'}</b>
              <small>{s.sensor.name}</small>
            </div>
          );
        })}
        {pumpOn && <div className="tvp__map-flag tvp__map-flag--on">Irrigando agora</div>}
        <span className="tvp__dim tvp__dim--w">
          {ROOM.widthM} × {ROOM.lengthM} m
        </span>
      </div>
      <div className="tvp__qv-side">
      {head}
      <ScaleBar quantity={quantity} lo={scale.lo} hi={scale.hi} stops={stops} values={vals.map((x) => x.v)} />
      {hiS && loS && hiS.v - loS.v > 0 && (
        <div className="tvp__insight">
          <b>{hiS.name}</b> {fmtNum(hiS.v - loS.v, u.digits)}
          {quantity === 'temperature' ? '° mais quente' : ' pontos mais úmido'} que <b>{loS.name}</b>
        </div>
      )}
      {footer}
      </div>
    </div>
  );
}

/** Escala de cores com os valores (como num mapa térmico) e a posição de cada sensor. */
function ScaleBar({ quantity, lo, hi, stops, values }: { quantity: Quantity; lo: number; hi: number; stops: ReturnType<typeof heatStops>; values: number[] }) {
  const u = UNIT[quantity];
  const pos = (v: number) => `${((v - lo) / (hi - lo)) * 100}%`;
  const N = 24;
  const gradient = `linear-gradient(90deg, ${Array.from({ length: N + 1 }, (_, i) => {
    const [r, g, b] = colorAt(stops, lo + ((hi - lo) * i) / N);
    return `rgb(${r | 0},${g | 0},${b | 0}) ${(i / N) * 100}%`;
  }).join(', ')})`;
  const digits = hi - lo < 5 ? 1 : 0;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => lo + f * (hi - lo));
  return (
    <div className="tvp__legend" aria-label="Escala de cores">
      <div className="tvp__legend-bar" style={{ background: gradient }}>
        {values.map((v, i) => (
          <span key={i} className="tvp__legend-mark" style={{ left: pos(v) }} />
        ))}
      </div>
      <div className="tvp__legend-ticks">
        {ticks.map((t, i) => (
          <span key={i} style={{ left: `${i * 25}%` }}>
            {fmtNum(t, digits)}
            {u.suffix}
          </span>
        ))}
      </div>
    </div>
  );
}
