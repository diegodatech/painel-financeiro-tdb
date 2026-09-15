const CACHE = 'tdb-launcher-v9-mobile-2-4';
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
      .then(cache => Promise.all(SHELL.map(url =>
        fetch(url, { cache: 'reload' })
          .then(resp => resp && resp.ok ? cache.put(url, resp.clone()) : null)
          .catch(() => null)
      )))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys
        .filter(k => k.startsWith('tdb-launcher-') && k !== CACHE)
        .map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || req.method !== 'GET') return;

  // O launcher e a navegação são sempre rede-primeiro para não prender versão antiga.
  if (req.mode === 'navigate' || url.pathname.endsWith('/index.html')) {
    event.respondWith(
      fetch(req, { cache: 'no-store' })
        .then(async resp => {
          if (resp && resp.ok) {
            const cache = await caches.open(CACHE);
            await cache.put(req, resp.clone());
          }
          return resp;
        })
        .catch(() => caches.match(req).then(r => r || caches.match(new URL('./index.html', self.registration.scope).href)))
    );
    return;
  }

  event.respondWith(
    caches.match(req).then(cached => cached || fetch(req, { cache: 'no-store' }).then(async resp => {
      if (resp && resp.ok) {
        const cache = await caches.open(CACHE);
        await cache.put(req, resp.clone());
      }
      return resp;
    }))
  );
});
