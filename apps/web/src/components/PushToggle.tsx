import { useEffect, useState } from 'react';
import { api } from '../lib/api';

const supported = () => typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
const standalone = () => window.matchMedia?.('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;

function keyBytes(b64: string): Uint8Array {
  const s = atob(b64.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((b64.length + 3) % 4));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

/** Registra o app (service worker) ao abrir: permite instalar no celular. */
export function registerApp() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => undefined);
}

/** Botão "Ativar avisos neste celular" (Web Push). */
export function PushToggle() {
  const [state, setState] = useState<'checking' | 'off' | 'on' | 'busy' | 'denied' | 'unsupported' | 'ios-install'>('checking');
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!supported()) {
      setState(isIos() && !standalone() ? 'ios-install' : 'unsupported');
      return;
    }
    if (Notification.permission === 'denied') return setState('denied');
    navigator.serviceWorker.ready
      .then((r) => r.pushManager.getSubscription())
      .then((s) => setState(s ? 'on' : 'off'))
      .catch(() => setState('off'));
  }, []);

  const enable = async () => {
    setState('busy');
    setMsg(null);
    try {
      const reg = await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;
      if ((await Notification.requestPermission()) !== 'granted') return setState('denied');
      const { publicKey } = await api.pushKey();
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) as BufferSource });
      await api.pushSubscribe(sub.toJSON());
      await api.pushTest(sub.endpoint);
      setState('on');
      setMsg('Avisos ativados. Você deve receber uma notificação de teste agora.');
    } catch (e) {
      setState('off');
      setMsg(`Não foi possível ativar: ${(e as Error).message}`);
    }
  };
  const disable = async () => {
    setState('busy');
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      await api.pushUnsubscribe(sub.endpoint).catch(() => undefined);
      await sub.unsubscribe();
    }
    setState('off');
    setMsg(null);
  };

  if (state === 'checking' || state === 'unsupported') return null;
  return (
    <div className="push-toggle hide-tv">
      {state === 'ios-install' && <span className="small">No iPhone: toque em Compartilhar → “Adicionar à Tela de Início” e abra pelo ícone para ativar os avisos.</span>}
      {state === 'denied' && <span className="small">Avisos bloqueados neste aparelho. Libere as notificações nas configurações do navegador.</span>}
      {(state === 'off' || state === 'busy') && (
        <button type="button" className="btn btn--sm" disabled={state === 'busy'} onClick={enable}>
          🔔 {state === 'busy' ? 'Ativando…' : 'Ativar avisos neste celular'}
        </button>
      )}
      {state === 'on' && (
        <button type="button" className="btn btn--sm" onClick={disable} title="Desativar avisos neste aparelho">
          🔔 Avisos ativos
        </button>
      )}
      {msg && <span className="small">{msg}</span>}
    </div>
  );
}
