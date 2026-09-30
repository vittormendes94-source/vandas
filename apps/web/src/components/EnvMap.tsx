import { useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { ROOM, assessCoverage, buildField, fmtNum, idwAt, insideConvexHull } from '@orq/core';
import type { AppConfig, Dataset, Quantity, Snapshot } from '@orq/core';
import { rampColor, rampGradientCss } from '../lib/colors';
import { Chip, EstChip, OriginChip } from './ui';

const COLS = 96;
const ROWS = 40;

const META: Record<Quantity, { title: string; unit: string; digits: number; short: string }> = {
  temperature: { title: 'Mapa de temperatura', unit: '°C', digits: 1, short: 'temperatura' },
  humidity: { title: 'Mapa de umidade relativa do ar', unit: '% UR', digits: 0, short: 'umidade relativa do ar' },
};

interface Props {
  quantity: Quantity;
  snapshot: Snapshot;
  config: AppConfig;
  dataset: Dataset;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** Rótulo do instante exibido (ex.: "replay 30/09 14:05"); ausente = tempo real. */
  instantLabel?: string;
  replay?: boolean;
}

export function MapCard({ quantity, snapshot, config, dataset, selectedId, onSelect, instantLabel, replay }: Props) {
  const meta = META[quantity];
  const scale = config.scales[quantity];
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [tip, setTip] = useState<{ left: number; top: number; text: string } | null>(null);

  const points = useMemo(
    () =>
      snapshot.sensors
        .filter((s) => s.valid && s.reading)
        .map((s) => ({ x: s.sensor.xM, y: s.sensor.yM, v: quantity === 'temperature' ? s.reading!.temperatureC : s.reading!.humidityPct })),
    [snapshot, quantity],
  );
  const coverage = useMemo(() => assessCoverage(points), [points]);
  const field = useMemo(() => (coverage.state === 'ok' ? buildField(points, ROOM.lengthM, ROOM.widthM, COLS, ROWS) : null), [coverage, points]);

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
    ctx.fillStyle = '#081015';
    ctx.fillRect(0, 0, W, H);
    const px = (xm: number) => (xm / ROOM.lengthM) * W;
    const py = (ym: number) => (ym / ROOM.widthM) * H;

    if (field && coverage.state === 'ok') {
      const off = document.createElement('canvas');
      off.width = COLS;
      off.height = ROWS;
      const octx = off.getContext('2d')!;
      const img = octx.createImageData(COLS, ROWS);
      const span = scale.max - scale.min || 1;
      for (let i = 0; i < COLS * ROWS; i++) {
        const [r, g, b] = rampColor(quantity, (field.values[i]! - scale.min) / span);
        img.data[i * 4] = r;
        img.data[i * 4 + 1] = g;
        img.data[i * 4 + 2] = b;
        img.data[i * 4 + 3] = field.inside[i] ? 255 : 105; // extrapolado: mais transparente
      }
      octx.putImageData(img, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(off, 0, 0, W, H);

      // hachura sobre a região EXTRAPOLADA (fora do polígono formado pelos sensores)
      ctx.save();
      const clip = new Path2D();
      clip.rect(0, 0, W, H);
      coverage.hull.forEach((p, i) => (i === 0 ? clip.moveTo(px(p.x), py(p.y)) : clip.lineTo(px(p.x), py(p.y))));
      clip.closePath();
      ctx.clip(clip, 'evenodd');
      ctx.strokeStyle = 'rgba(255,255,255,0.28)';
      ctx.lineWidth = 1;
      for (let k = -H; k < W; k += 9) {
        ctx.beginPath();
        ctx.moveTo(k, H);
        ctx.lineTo(k + H, 0);
        ctx.stroke();
      }
      ctx.restore();

      // contorno da área delimitada pelos sensores
      ctx.save();
      ctx.setLineDash([6, 4]);
      ctx.strokeStyle = 'rgba(255,255,255,0.75)';
      ctx.lineWidth = 1.25;
      ctx.beginPath();
      coverage.hull.forEach((p, i) => (i === 0 ? ctx.moveTo(px(p.x), py(p.y)) : ctx.lineTo(px(p.x), py(p.y))));
      ctx.closePath();
      ctx.stroke();
      ctx.restore();
    }

    // grade de 1 m
    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.lineWidth = 1;
    for (let x = 1; x < ROOM.lengthM; x++) {
      ctx.beginPath();
      ctx.moveTo(px(x), 0);
      ctx.lineTo(px(x), H);
      ctx.stroke();
    }
    for (let y = 1; y < ROOM.widthM; y++) {
      ctx.beginPath();
      ctx.moveTo(0, py(y));
      ctx.lineTo(W, py(y));
      ctx.stroke();
    }
  }, [field, coverage, size, scale, quantity]);

  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!field || coverage.state !== 'ok') return setTip(null);
    const rect = e.currentTarget.getBoundingClientRect();
    const xm = ((e.clientX - rect.left) / rect.width) * ROOM.lengthM;
    const ym = ((e.clientY - rect.top) / rect.height) * ROOM.widthM;
    if (xm < 0 || ym < 0 || xm > ROOM.lengthM || ym > ROOM.widthM) return setTip(null);
    const v = idwAt(points, xm, ym);
    if (v === null) return setTip(null);
    const inside = insideConvexHull(coverage.hull, xm, ym);
    setTip({
      left: e.clientX - rect.left,
      top: e.clientY - rect.top,
      text: `≈ ${fmtNum(v, meta.digits)} ${meta.unit} (estimativa${inside ? '' : ', extrapolada'}) · x ${fmtNum(xm, 1)} m, y ${fmtNum(ym, 1)} m`,
    });
  };

  const xTicks = [0, 2, 4, 6, 8, 10, 12];
  const yTicks = [0, 1, 2, 3, 4, 5];
  const north = config.orientation.northAngleDeg;
  const mid = (scale.min + scale.max) / 2;

  return (
    <section className="card" aria-label={meta.title}>
      <div className="card__head">
        <div>
          <h2 className="card__title">{meta.title}</h2>
          <div className="card__sub hide-tv">
            {ROOM.lengthM} m × {ROOM.widthM} m ({ROOM.lengthM * ROOM.widthM} m²) · {instantLabel ?? 'tempo real'}
          </div>
        </div>
        <div className="toolbar">
          <OriginChip dataset={dataset} />
          <EstChip />
        </div>
      </div>

      <div className="map">
        <div className="map__ruler-x" aria-hidden="true">
          {xTicks.map((x) => (
            <span key={x} style={{ left: `${(x / ROOM.lengthM) * 100}%` }}>
              {x === 12 ? '12 m' : x}
            </span>
          ))}
        </div>
        <div className="map__ruler-y" aria-hidden="true">
          {yTicks.map((y) => (
            <span key={y} style={{ top: `${(y / ROOM.widthM) * 100}%` }}>
              {y}
            </span>
          ))}
        </div>
        <div className="map__stage" ref={stageRef} onPointerMove={onMove} onPointerLeave={() => setTip(null)} onPointerDown={onMove}>
          <canvas ref={canvasRef} role="img" aria-label={`${meta.title}: estimativa espacial entre os sensores`} />
          <div className="map__overlay">
            {snapshot.sensors.map((s) => {
              const val = quantity === 'temperature' ? s.reading?.temperatureC : s.reading?.humidityPct;
              const cls = ['pin', s.freshness === 'delayed' ? 'pin--delayed' : '', s.freshness === 'unavailable' ? 'pin--off' : '', selectedId === s.sensor.id ? 'pin--sel' : '', s.sensor.positionProvisional ? 'pin--prov' : '']
                .filter(Boolean)
                .join(' ');
              const label =
                s.freshness === 'fresh' && val !== undefined
                  ? `${fmtNum(val, meta.digits)} ${meta.unit === '°C' ? '°C' : '%'}`
                  : s.freshness === 'delayed' && val !== undefined
                    ? `${fmtNum(val, meta.digits)} (atrasado)`
                    : replay
                      ? 'sem leitura'
                      : 'sem sinal';
              return (
                <button
                  key={s.sensor.id}
                  type="button"
                  className={cls}
                  style={{ left: `${(s.sensor.xM / ROOM.lengthM) * 100}%`, top: `${(s.sensor.yM / ROOM.widthM) * 100}%` }}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelect(selectedId === s.sensor.id ? null : s.sensor.id);
                  }}
                  aria-pressed={selectedId === s.sensor.id}
                  aria-label={`${s.sensor.name}: ${label}${s.sensor.positionProvisional ? ' (posição provisória)' : ''}`}
                  title={`${s.sensor.name}${s.sensor.positionProvisional ? ' — posição provisória' : ''}`}
                >
                  <span className="pin__id">{s.sensor.id.toUpperCase()}</span>
                  <span className="pin__val">{label}</span>
                </button>
              );
            })}
          </div>
          {coverage.state !== 'ok' && <div className="map__flag">Sem mapa estimado</div>}
          <div className="map__north" aria-label={north === null ? 'Orientação não informada' : `Norte a ${north} graus`}>
            {north === null ? (
              <span>Norte não informado</span>
            ) : (
              <>
                <svg width="16" height="16" viewBox="-8 -8 16 16" style={{ transform: `rotate(${north}deg)` }} aria-hidden="true">
                  <path d="M0 -7 L4 5 L0 2 L-4 5 Z" fill="#e8f2f3" />
                </svg>
                N
              </>
            )}
          </div>
          {tip && (
            <div className="map__tip" style={{ left: tip.left, top: tip.top }}>
              {tip.text}
            </div>
          )}
        </div>
      </div>

      {coverage.state !== 'ok' && (
        <div className="notice notice--warn small" role="status" style={{ marginTop: '0.6rem' }}>
          <strong>Cobertura insuficiente para estimar o mapa.</strong> {coverage.reason} Somente os pontos com leitura válida são mostrados; nenhuma área é inventada.
        </div>
      )}

      <div className="legend">
        <div className="legend__bar" style={{ background: rampGradientCss(quantity) }} aria-hidden="true" />
        <div className="legend__ticks">
          <span>
            {fmtNum(scale.min, 0)} {meta.unit}
          </span>
          <span>{fmtNum(mid, 0)}</span>
          <span>
            {fmtNum(scale.max, 0)} {meta.unit}
          </span>
        </div>
        <div className="legend__keys hide-tv">
          <span>
            <i className="key-measured" />
            Valor medido no ponto
          </span>
          <span>
            <i className="key-est" />
            Cor entre sensores: estimativa (IDW)
          </span>
          <span>
            <i className="key-extrap" />
            Hachurado: extrapolado (fora da área entre os sensores)
          </span>
        </div>
        <p className="tiny mute hide-tv" style={{ margin: '0.5rem 0 0' }}>
          Escala fixa ({scale.min}–{scale.max} {meta.unit}) para comparar momentos; não representa faixa ideal. Três sensores não medem gradientes
          reais: a interpolação só suaviza por distância.{' '}
          {quantity === 'humidity' && 'Umidade do ar — não indica umidade do substrato nem hidratação das raízes.'}
        </p>
      </div>
      {snapshot.sensors.some((s) => s.sensor.positionProvisional) && (
        <p className="tiny hide-tv" style={{ margin: '0.4rem 0 0' }}>
          <Chip kind="warn">Posição provisória</Chip> <span className="mute">Sensores marcados com “?” estão em posições ilustrativas até você informar as reais.</span>
        </p>
      )}
    </section>
  );
}
