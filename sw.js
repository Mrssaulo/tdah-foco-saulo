// Service Worker - offline-first + handlers de notificacao
const CACHE = 'foco-tdah-v12';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './alarm.js',
  './manifest.json',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './assets/alarm.wav'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Network-first for HTML so updates propagate, fallback to cache when offline.
// Cache-first for everything else.
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);

  // Only handle same-origin requests through the cache strategy
  if (url.origin !== self.location.origin) return;

  const isHTML = e.request.headers.get('accept')?.includes('text/html');

  if (isHTML) {
    // Network first, cache fallback
    e.respondWith(
      fetch(e.request)
        .then(res => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => caches.match('./index.html').then(r => r || caches.match(e.request)))
    );
    return;
  }

  // Cache first for static assets
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(res => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
        }
        return res;
      }).catch(() => cached);
    })
  );
});

// Foca o app ao clicar na notificacao
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window' }).then(list => {
      for (const c of list) {
        if (c.visibilityState === 'visible') { c.focus(); return; }
      }
      if (self.clients.openWindow) return self.clients.openWindow('./');
    })
  );
});

// Recebe texto compartilhado via share intent
self.addEventListener('message', e => {
  if (e.data?.type === 'share-received' && e.data.text) {
    self.clients.matchAll({ type: 'window' }).then(list => {
      list.forEach(c => c.postMessage({ type: 'shared-text', text: e.data.text }));
    });
  }
});