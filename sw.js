const CACHE = 'tdb-launcher-v6';
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './logo.png',
  './icon-192.png',
  './icon-512.png'
].map(path => new URL(path, self.registration.scope).href);

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => Promise.all(
        SHELL.map(url =>
          fetch(url, { cache: 'reload' })
            .then(resp => {
              if (resp && resp.ok) return cache.put(url, resp.clone());
            })
            .catch(() => null)
        )
      ))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(k => k.startsWith('tdb-launcher-') && k !== CACHE)
          .map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// O launcher do GitHub abre do cache imediatamente e atualiza em segundo plano.
// O Apps Script é de outra origem e NÃO é interceptado nem cacheado aqui.
self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || req.method !== 'GET') return;

  const atualizar = fetch(req, { cache: 'no-store' })
    .then(async resp => {
      if (resp && resp.ok) {
        const cache = await caches.open(CACHE);
        await cache.put(req, resp.clone());
      }
      return resp;
    });

  event.respondWith(
    caches.match(req).then(cached => cached || atualizar)
  );

  event.waitUntil(atualizar.catch(() => null));
});
