// TDB V10 — desativador de Service Worker antigo.
// A V10 não usa cache do launcher para evitar retenção de versões antigas no Safari/iOS.
self.addEventListener('install', event => {
  self.skipWaiting();
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.filter(k => k.startsWith('tdb-launcher-')).map(k => caches.delete(k)));
    } catch (_) {}
    try { await self.registration.unregister(); } catch (_) {}
    try {
      const clientsList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      clientsList.forEach(client => client.navigate(client.url));
    } catch (_) {}
  })());
});
