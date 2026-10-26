import { useEffect, useState } from 'react';

export type Route = 'simples' | 'painel' | 'historico' | 'config' | 'dados';
const ROUTES: Route[] = ['simples', 'painel', 'historico', 'config', 'dados'];

/** Sem rota no endereço: a TV (?tv=1) abre o painel da TV; os demais, o painel completo. */
function parse(): Route {
  const h = location.hash.replace(/^#\/?/, '').split('?')[0] ?? '';
  if ((ROUTES as string[]).includes(h)) return h as Route;
  return new URLSearchParams(location.search).get('tv') === '1' ? 'simples' : 'painel';
}

export function useHashRoute(): [Route, (r: Route) => void] {
  const [route, setRoute] = useState<Route>(parse);
  useEffect(() => {
    const on = () => setRoute(parse());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return [route, (r) => (location.hash = `#/${r}`)];
}

/** Parâmetros depois de "?" no hash (ex.: #/dados?ewelink=conectado). */
export function hashQuery(): URLSearchParams {
  const i = location.hash.indexOf('?');
  return new URLSearchParams(i >= 0 ? location.hash.slice(i + 1) : '');
}
