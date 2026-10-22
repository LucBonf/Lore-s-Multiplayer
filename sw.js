const CACHE_NAME = 'lucas-cache-v3';
const urlsToCache = [
  '/',
  '/index.html',
  '/style.css',
  '/js/main.js?v=3.2',
  '/js/i18n.js'
];

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        return cache.addAll(urlsToCache);
      })
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.map(k => {
          if (k !== CACHE_NAME) {
            return caches.delete(k);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  // Ignora le richieste per le API, Socket.io e le connessioni esterne
  if (event.request.url.includes('/api/') || event.request.url.includes('socket.io') || !event.request.url.startsWith(self.location.origin)) {
    return;
  }

  // Network First, fallback to cache
  event.respondWith(
    fetch(event.request, { cache: 'no-cache' }).catch(() => {
      return caches.match(event.request);
    })
  );
});
