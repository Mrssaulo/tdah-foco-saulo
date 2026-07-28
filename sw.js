// Service Worker - cache offline + handlers de notificacao
const CACHE = 'foco-tdah-v9';
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
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(res => {
        // So cachear respostas bem-sucedidas. Antes gravava ate 404 e travava o SW.
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
