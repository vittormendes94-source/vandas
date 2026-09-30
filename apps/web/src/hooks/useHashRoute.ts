import { useEffect, useState } from 'react';

export type Route = 'painel' | 'historico' | 'config' | 'dados';
const ROUTES: Route[] = ['painel', 'historico', 'config', 'dados'];

function parse(): Route {
  const h = location.hash.replace(/^#\/?/, '');
  return (ROUTES as string[]).includes(h) ? (h as Route) : 'painel';
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
