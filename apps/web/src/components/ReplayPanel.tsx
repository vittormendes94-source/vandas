import { formatDateTime, localInputToUtc, utcToLocalInput } from '@orq/core';
import type { Gap, IrrigationPeriod } from '@orq/core';

export const REPLAY_SPEEDS = [5, 15, 30, 60, 180] as const;

interface Props {
  from: number;
  to: number;
  at: number;
  onAt: (t: number) => void;
  playing: boolean;
  onPlaying: (p: boolean) => void;
  speed: number;
  onSpeed: (s: number) => void;
  windowHours: number;
  onWindowHours: (h: number) => void;
  irrigation: IrrigationPeriod[];
  gaps: Gap[];
  loading: boolean;
  hourly: boolean;
  toleranceMin: number;
  stepMs: number;
  onExit: () => void;
  error?: string | null;
}

/** Replay dos mapas: linha do tempo, reproduzir/pausar, velocidade, seleção de horário e retorno ao tempo real. */
export function ReplayPanel(p: Props) {
  const pct = (t: number) => `${Math.min(100, Math.max(0, ((t - p.from) / (p.to - p.from)) * 100))}%`;
  const wid = (a: number, b: number) => `${Math.max(0.4, ((Math.min(b, p.to) - Math.max(a, p.from)) / (p.to - p.from)) * 100)}%`;
  return (
    <section className="card replay" aria-label="Replay dos mapas">
      <div className="card__head" style={{ marginBottom: 0 }}>
        <div>
          <h2 className="card__title">Replay histórico dos mapas</h2>
          <div className="card__sub">
            Instante: <strong style={{ color: 'var(--text)' }}>{formatDateTime(p.at)}</strong> · leituras combinadas com tolerância de{' '}
            {p.hourly ? 'até 1 h 30 (médias horárias)' : `${p.toleranceMin} min`}; sensores sem leitura no instante ficam de fora (nada é preenchido).
          </div>
        </div>
        <button type="button" className="btn btn--primary" onClick={p.onExit}>
          ● Voltar ao acompanhamento atual
        </button>
      </div>

      <div className="replay__row">
        <button type="button" className="btn" onClick={() => p.onPlaying(!p.playing)} aria-label={p.playing ? 'Pausar replay' : 'Reproduzir replay'} disabled={p.loading}>
          {p.playing ? '⏸ Pausar' : '▶ Reproduzir'}
        </button>
        <input
          type="range"
          min={p.from}
          max={p.to}
          step={p.stepMs}
          value={p.at}
          onChange={(e) => {
            p.onPlaying(false);
            p.onAt(Number(e.target.value));
          }}
          aria-label="Linha do tempo do replay"
        />
      </div>
      <div className="timeline" aria-hidden="true">
        {p.gaps.map((g, i) => (
          <i key={`g${i}`} className="tl-gap" style={{ left: pct(g.from), width: wid(g.from, g.to) }} title="Lacuna: sem leituras" />
        ))}
        {p.irrigation.map((g, i) => (
          <i key={`i${i}`} className="tl-irr" style={{ left: pct(g.startedAt), width: wid(g.startedAt, g.endedAt ?? p.to) }} title="Relé ligado (informado)" />
        ))}
        <i className="tl-now" style={{ left: pct(p.at) }} />
      </div>
      <div className="tiny mute">
        <span style={{ color: 'var(--cyan)' }}>▮</span> relé ligado (informado) · <span style={{ color: 'var(--amber)' }}>▨</span> lacunas sem leituras ({p.gaps.length}) · <span style={{ color: 'var(--green)' }}>│</span> instante atual do replay
      </div>

      <div className="replay__row">
        <label className="field" style={{ minWidth: '12rem' }}>
          <span>Ir para o horário (America/Sao_Paulo)</span>
          <input
            className="input"
            type="datetime-local"
            value={utcToLocalInput(p.at)}
            min={utcToLocalInput(p.from)}
            max={utcToLocalInput(p.to)}
            onChange={(e) => {
              const t = localInputToUtc(e.target.value);
              if (t !== null) {
                p.onPlaying(false);
                p.onAt(Math.min(p.to, Math.max(p.from, t)));
              }
            }}
          />
        </label>
        <div className="field">
          <span>Velocidade (tempo simulado por segundo)</span>
          <div className="seg" role="group" aria-label="Velocidade do replay">
            {REPLAY_SPEEDS.map((s) => (
              <button key={s} type="button" aria-pressed={p.speed === s} onClick={() => p.onSpeed(s)}>
                {s} min/s
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <span>Janela</span>
          <div className="seg" role="group" aria-label="Janela do replay">
            {[
              [24, '24 h'],
              [48, '48 h'],
              [168, '7 dias'],
            ].map(([h, l]) => (
              <button key={h} type="button" aria-pressed={p.windowHours === h} onClick={() => p.onWindowHours(h as number)}>
                {l}
              </button>
            ))}
          </div>
        </div>
      </div>
      {p.loading && <div className="small dim">Carregando histórico…</div>}
      {p.error && <div className="notice notice--bad">{p.error}</div>}
      {p.hourly && <div className="tiny" style={{ color: 'var(--amber)' }}>Janelas de 7 dias usam médias horárias (resolução menor que a das leituras brutas).</div>}
    </section>
  );
}
