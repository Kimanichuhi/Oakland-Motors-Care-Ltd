const CACHE = 'oakland-shell-v3';
const APP_SHELL = ['/','/manifest.webmanifest','/icon.svg','/icon','/icon-192','/icon-512','/apple-icon'];
self.addEventListener('install', (event) => event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(APP_SHELL))));
self.addEventListener('activate', (event) => event.waitUntil(Promise.all([
  caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))),
  self.clients.claim(),
])));
self.addEventListener('fetch', (event) => { if (event.request.method !== 'GET') return; event.respondWith(fetch(event.request).catch(() => caches.match(event.request).then((cached) => cached || caches.match('/')))); });
// Lets the /install page's "check for updates" button force a waiting worker
// to take over immediately instead of waiting for every tab to close.
self.addEventListener('message', (event) => { if (event.data === 'SKIP_WAITING') self.skipWaiting(); });
