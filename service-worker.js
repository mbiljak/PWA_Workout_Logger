const CACHE_NAME = 'workout-pwa-v2'; // always increment for official updates
const ASSETS = [
    './',
    './index.html',
    './css/style.css',
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
        caches.keys().then(keys => {
            return Promise.all(keys
                .filter(key => key !== CACHE_NAME)
                .map(key => caches.delete(key))
            );
        })
    );
});

self.addEventListener('fetch', event => {
    event.respondWith(
        caches.match(event.request).then(cachedResponse => {
            return cachedResponse || fetch(event.request);
        })
    );
});