const CACHE = 'oakland-shell-v2';
const APP_SHELL = ['/','/manifest.webmanifest','/icon.svg','/icon','/icon-192','/icon-512','/apple-icon'];
self.addEventListener('install', (event) => event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(APP_SHELL))));
self.addEventListener('activate', (event) => event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))));
self.addEventListener('fetch', (event) => { if (event.request.method !== 'GET') return; event.respondWith(fetch(event.request).catch(() => caches.match(event.request).then((cached) => cached || caches.match('/')))); });
