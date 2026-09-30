import type { Dataset } from '@orq/core';

/** Preferências de interface (não são medições). Ficam no localStorage; falhas de acesso são ignoradas. */
const KEY = 'orq.prefs.v1';

export interface Prefs {
  dataset: Dataset | null;
  pollSeconds: number;
}

const DEFAULTS: Prefs = { dataset: null, pollSeconds: 60 };

export function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    const p = JSON.parse(raw) as Partial<Prefs>;
    return {
      dataset: p.dataset === 'demo' || p.dataset === 'real' ? p.dataset : null,
      pollSeconds: [30, 60, 120, 300].includes(p.pollSeconds as number) ? (p.pollSeconds as number) : 60,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function savePrefs(p: Prefs) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* ignorar */
  }
}

/** Parâmetros da URL: ?modo=real|demo e ?tv=1. A URL tem precedência sobre as preferências salvas. */
export function urlParams(): { dataset: Dataset | null; tv: boolean } {
  const q = new URLSearchParams(location.search);
  const m = q.get('modo');
  return { dataset: m === 'real' || m === 'demo' ? m : null, tv: q.get('tv') === '1' };
}
