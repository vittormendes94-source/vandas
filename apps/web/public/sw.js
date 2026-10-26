// Service worker do Orquidário Inteligente: só recebe avisos (Web Push) e abre o app ao tocar.
// Não guarda páginas em cache: o painel sempre mostra dados atuais.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
self.addEventListener('push', (e) => {
  let d = { title: 'Orquidário Inteligente', body: '', tag: 'aviso' };
  try {
    d = { ...d, ...e.data.json() };
  } catch {}
  e.waitUntil(self.registration.showNotification(d.title, { body: d.body, tag: d.tag, icon: '/icon-192.png', badge: '/icon-192.png', renotify: true }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) if ('focus' in c) return c.focus();
      return self.clients.openWindow('/#/simples');
    }),
  );
});
