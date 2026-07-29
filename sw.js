// Service Worker - offline-first agressivo
// Garante que o app abre do cache mesmo sem rede.
// Em paralelo, busca versão nova em background e atualiza o cache pra proxima vez.

const CACHE = 'foco-tdah-v14';
const PRECACHE = 'foco-tdah-precache-v14';
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
  './assets/alarm.wav',
  './offline.html'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(PRECACHE)
      .then(c => c.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE && k !== PRECACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Estrategia: cache-first pra tudo (maxima resiliencia offline).
// Em paralelo tenta network e atualiza o cache pra proxima vez.
// Se nao tiver no cache E nao tiver rede, devolve offline.html.
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;

  const url = new URL(e.request.url);
  // So atende requisicoes do mesmo origin
  if (url.origin !== self.location.origin) return;

  e.respondWith(
    caches.match(e.request).then(cached => {
      const networkFetch = fetch(e.request).then(res => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
        }
        return res;
      }).catch(() => null);

      if (cached) {
        // Tem no cache: retorna imediato, rede roda em background pra atualizar
        return cached;
      }
      // Nao tem no cache: tenta rede; se cair, devolve offline
      return networkFetch.then(res => {
        if (res) return res;
        if (e.request.headers.get('accept')?.includes('text/html')) {
          return caches.match('./offline.html');
        }
        return new Response('', { status: 504, statusText: 'Offline' });
      });
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

// Avisa clientes sobre atualizacao disponivel
self.addEventListener('message', e => {
  if (e.data?.type === 'SKIP_WAITING') self.skipWaiting();
});