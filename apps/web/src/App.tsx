import { useEffect, useMemo, useState } from 'react';
import { fmtNum, formatAge, formatTimeSec, readingFromDto } from '@orq/core';
import type { Dataset } from '@orq/core';
import { LogoMark } from './components/ui';
import { useHashRoute } from './hooks/useHashRoute';
import type { Route } from './hooks/useHashRoute';
import { useLive, useServerNow } from './hooks/useLive';
import { api, setViewToken } from './lib/api';
import type { Meta } from './lib/api';
import { loadPrefs, savePrefs, urlParams } from './lib/prefs';
import { About } from './pages/About';
import { Dashboard } from './pages/Dashboard';
import { History } from './pages/History';
import { Settings } from './pages/Settings';
import { buildSnapshot } from '@orq/core';
import type { Reading } from '@orq/core';

const NAV: { id: Route; label: string }[] = [
  { id: 'painel', label: 'Painel' },
  { id: 'historico', label: 'Histórico' },
  { id: 'config', label: 'Configurações' },
  { id: 'dados', label: 'Dados e integração' },
];

export function App() {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [metaError, setMetaError] = useState<string | null>(null);
  const [prefs, setPrefs] = useState(loadPrefs);
  const [tv, setTv] = useState(() => urlParams().tv);
  const [fullscreen, setFullscreen] = useState(false);
  const [route, go] = useHashRoute();
  const [urlDataset] = useState(() => urlParams().dataset);

  useEffect(() => {
    api
      .meta()
      .then(setMeta)
      .catch((e) => setMetaError(String(e.message ?? e)));
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle('tv', tv);
  }, [tv]);
  useEffect(() => {
    const on = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', on);
    return () => document.removeEventListener('fullscreenchange', on);
  }, []);

  const dataset: Dataset = useMemo(() => {
    if (!meta) return 'demo';
    const wanted = urlDataset ?? prefs.dataset ?? meta.defaultDataset;
    return wanted === 'demo' && !meta.demoEnabled ? 'real' : wanted;
  }, [meta, urlDataset, prefs.dataset]);

  const live = useLive(dataset, prefs.pollSeconds);
  const nowMs = useServerNow(live);

  const setDataset = (d: Dataset) => {
    const next = { ...prefs, dataset: d };
    setPrefs(next);
    savePrefs(next);
    if (urlDataset) {
      const u = new URL(location.href);
      u.searchParams.delete('modo');
      history.replaceState(null, '', u);
      location.reload();
    }
  };
  const setPoll = (s: number) => {
    const next = { ...prefs, pollSeconds: s };
    setPrefs(next);
    savePrefs(next);
  };
  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      /* o navegador pode negar tela cheia */
    }
  };

  // Resumo para a barra de atualização (sempre visível)
  const summary = useMemo(() => {
    if (!live.data) return null;
    const latest = new Map<string, Reading | null>(Object.entries(live.data.latest).map(([id, r]) => [id, r ? readingFromDto(r) : null]));
    return buildSnapshot(live.data.config, latest, nowMs);
  }, [live.data, nowMs]);

  if (metaError && !meta) {
    return (
      <div className="container" style={{ paddingTop: '2rem' }}>
        <div className="notice notice--bad">
          <strong>Não foi possível falar com o servidor.</strong> {metaError}
        </div>
      </div>
    );
  }
  if (!meta) return <div className="empty">Carregando…</div>;

  const activeRoute: Route = tv ? 'painel' : route;
  const staleRefresh = live.error !== null;

  return (
    <>
      {dataset === 'demo' ? (
        <div className="demo-banner" role="status">
          DEMONSTRAÇÃO — DADOS SIMULADOS
        </div>
      ) : (
        <div className="real-banner">Dados reais · nenhum dado simulado neste modo</div>
      )}

      <header>
        <div className="topbar">
          <div className="brand">
            <LogoMark className="brand__logo" />
            <div>
              <div className="brand__title">Orquidário Inteligente</div>
              <div className="brand__sub">Vandas · 12 × 5 m · 60 m² · {live.data?.config.sensors.length ?? 3} pontos de monitoramento</div>
            </div>
          </div>

          {!tv && (
            <nav className="nav" aria-label="Navegação principal">
              {NAV.map((n) => (
                <button key={n.id} type="button" aria-current={route === n.id ? 'page' : undefined} onClick={() => go(n.id)}>
                  {n.label}
                </button>
              ))}
            </nav>
          )}

          <div className="toolbar" style={tv ? { marginLeft: 'auto' } : undefined}>
            {meta.demoEnabled && !tv && (
              <div className="seg" role="group" aria-label="Conjunto de dados">
                <button type="button" aria-pressed={dataset === 'demo'} onClick={() => setDataset('demo')}>
                  Demonstração
                </button>
                <button type="button" aria-pressed={dataset === 'real'} onClick={() => setDataset('real')}>
                  Dados reais
                </button>
              </div>
            )}
            <button type="button" className="btn btn--sm" onClick={() => setTv(!tv)} aria-pressed={tv}>
              {tv ? 'Sair do modo TV' : '📺 Modo TV'}
            </button>
            <button type="button" className="btn btn--sm" onClick={toggleFullscreen}>
              {fullscreen ? 'Sair da tela cheia' : '⛶ Tela cheia'}
            </button>
          </div>
        </div>

        <div className="freshbar" role="status" aria-live="off">
          {live.data && summary ? (
            <>
              <span>
                <span className={`dot ${staleRefresh ? 'dot--bad' : summary.counts.fresh === summary.sensors.length ? 'dot--ok' : summary.counts.fresh > 0 ? 'dot--warn' : 'dot--bad'}`} />
                Última leitura medida:{' '}
                <strong>{summary.lastMeasuredAt ? `${formatTimeSec(summary.lastMeasuredAt)} · ${formatAge(nowMs - summary.lastMeasuredAt)}` : 'nenhuma'}</strong>
              </span>
              {summary.lastReceivedAt && <span>recebida às {formatTimeSec(summary.lastReceivedAt)}</span>}
              <span>
                <strong>{summary.counts.fresh}</strong> atualizado(s) · <strong>{summary.counts.delayed}</strong> atrasado(s) · <strong>{summary.counts.unavailable}</strong> sem comunicação
              </span>
              <span>
                Tela atualizada às {live.fetchedAtLocal ? formatTimeSec(live.fetchedAtLocal) : '—'} <span className="hide-tv">(a cada{' '}
                <select
                  aria-label="Intervalo de atualização"
                  value={prefs.pollSeconds}
                  onChange={(e) => setPoll(Number(e.target.value))}
                  style={{ background: 'transparent', border: '1px solid var(--line-2)', borderRadius: 6, color: 'inherit', fontSize: 'inherit', padding: '0 0.2rem' }}
                >
                  {[30, 60, 120, 300].map((s) => (
                    <option key={s} value={s} style={{ background: '#0e171d' }}>
                      {s} s
                    </option>
                  ))}
                </select>
                ) — atualizar a tela não renova a idade das leituras</span>
              </span>
              {staleRefresh && (
                <span style={{ color: 'var(--red)' }}>
                  Falha ao atualizar ({live.failures}×): exibindo a última resposta. {live.nextAtLocal ? `Nova tentativa em ${fmtNum(Math.max(0, (live.nextAtLocal - Date.now()) / 1000), 0)} s.` : ''}
                </span>
              )}
            </>
          ) : (
            <span>{live.error ? `Sem dados: ${live.error.message}` : 'Carregando dados…'}</span>
          )}
        </div>
      </header>

      {live.error?.status === 401 && <ViewTokenGate />}

      {activeRoute === 'painel' && <Dashboard live={live} nowMs={nowMs} dataset={dataset} tv={tv} onGoConfig={() => go('config')} />}
      {activeRoute === 'historico' && <History dataset={dataset} config={live.data?.config ?? null} nowMs={nowMs} />}
      {activeRoute === 'config' && <Settings dataset={dataset} live={live} meta={meta} />}
      {activeRoute === 'dados' && <About dataset={dataset} live={live} meta={meta} />}
    </>
  );
}

function ViewTokenGate() {
  const [v, setV] = useState('');
  return (
    <div className="container">
      <div className="notice notice--bad">
        <strong>Acesso protegido.</strong> Informe o token de visualização (o mesmo do endereço da TV: <code>?k=…</code>).
        <form
          style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem', flexWrap: 'wrap' }}
          onSubmit={(e) => {
            e.preventDefault();
            setViewToken(v.trim() || null);
            location.reload();
          }}
        >
          <input className="input" style={{ maxWidth: '22rem' }} type="password" autoComplete="off" value={v} onChange={(e) => setV(e.target.value)} placeholder="Token de visualização" aria-label="Token de visualização" />
          <button className="btn btn--primary" type="submit">
            Entrar
          </button>
        </form>
      </div>
    </div>
  );
}
