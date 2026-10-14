/** Preferências de interface (não são medições). Ficam no localStorage; falhas de acesso são ignoradas. */
const KEY = 'orq.prefs.v2';

export interface Prefs {
  pollSeconds: number;
}

const DEFAULTS: Prefs = { pollSeconds: 60 };

export function loadPrefs(): Prefs {
  try {
    const p = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Prefs>;
    return { pollSeconds: [30, 60, 120, 300].includes(p.pollSeconds as number) ? (p.pollSeconds as number) : DEFAULTS.pollSeconds };
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

/** ?tv=1 abre direto no modo TV. */
export function urlParams(): { tv: boolean } {
  return { tv: new URLSearchParams(location.search).get('tv') === '1' };
}
