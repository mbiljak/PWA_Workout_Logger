const CACHE_NAME = 'workout-pwa-v8'; // always increment for official updates
const ASSETS = [
    './',
    './index.html',
    './css/style.css',
    './js/exercises.js',
    './js/muscles.js',
    './js/db.js',
    './js/ui.js',
    './js/export.js',
    './data.csv',
    './manifest.json',
    './icon-192.png',
    './icon-512.png',
    './favicon.ico',
    'https://unpkg.com/dexie/dist/dexie.js'
];

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(ASSETS))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(keys
                .filter(key => key !== CACHE_NAME)
                .map(key => caches.delete(key))))
            .then(() => self.clients.claim()) // control open pages immediately
    );
});

// Network-first for our own files: always pick up the latest deploy when online,
// fall back to the cache only when offline. Cross-origin (Dexie CDN) stays cache-first.
self.addEventListener('fetch', event => {
    const { request } = event;
    if (request.method !== 'GET') return;

    const sameOrigin = new URL(request.url).origin === self.location.origin;

    if (sameOrigin) {
        event.respondWith(
            fetch(request)
                .then(response => {
                    const copy = response.clone();
                    caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
                    return response;
                })
                .catch(() => caches.match(request).then(
                    cached => cached || caches.match('./index.html')))
        );
    } else {
        event.respondWith(
            caches.match(request).then(cached => cached || fetch(request))
        );
    }
});
