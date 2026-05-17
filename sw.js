const CACHE_NAME = 'lucas-cache-v1';
const urlsToCache = [
  '/',
  '/index.html',
  '/style.css',
  '/js/main.js',
  '/js/i18n.js'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        return cache.addAll(urlsToCache);
      })
  );
});

self.addEventListener('fetch', event => {
  // Ignora le richieste per le API, Socket.io e le connessioni esterne
  if (event.request.url.includes('/api/') || event.request.url.includes('socket.io') || !event.request.url.startsWith(self.location.origin)) {
    return;
  }

  // Network First, fallback to cache
  event.respondWith(
    fetch(event.request).catch(() => {
      return caches.match(event.request);
    })
  );
});
