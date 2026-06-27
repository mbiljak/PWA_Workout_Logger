const CACHE_NAME = 'workout-pwa-v26'; // always increment for official updates
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
    './js/lib/dexie.min.js',
    './js/lib/chart.umd.js'
];

// Let the page ask which cache (i.e. which deploy) is actually serving it, so
// Settings can show the live version and you can tell when an update landed.
self.addEventListener('message', event => {
    if (event.data && event.data.type === 'GET_VERSION') {
        event.ports[0]?.postMessage(CACHE_NAME);
    }
});

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(ASSETS.map(u => new Request(u, { cache: 'reload' }))))
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

// Stale-while-revalidate for our own files: serve the cached copy instantly (so
// the installed PWA paints with no network wait), and refresh the cache in the
// background so the next launch runs the latest deploy. Cross-origin (Dexie /
// Chart.js CDN) stays cache-first.
//
// NOTE: this serves up to one-launch-old app code before the background refresh
// applies. That only matters when a deploy changes the IndexedDB schema in
// db.js — see the data-safety note in CLAUDE.md. It never affects logged data
// itself, which lives in IndexedDB and is untouched by the cache.
self.addEventListener('fetch', event => {
    const { request } = event;
    if (request.method !== 'GET') return;

    const sameOrigin = new URL(request.url).origin === self.location.origin;

    if (sameOrigin) {
        event.respondWith(
            caches.match(request).then(cached => {
                // Background refresh. `cache: 'reload'` bypasses the browser's
                // HTTP cache so the revalidation genuinely hits the origin
                // (GitHub Pages sends max-age=600 otherwise).
                const fetching = fetch(request, { cache: 'reload' })
                    .then(response => {
                        const copy = response.clone();
                        caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
                        return response;
                    })
                    .catch(() => cached || caches.match('./index.html'));

                // Serve cache immediately when present; otherwise wait on network.
                return cached || fetching;
            })
        );
    } else {
        event.respondWith(
            caches.match(request).then(cached => cached || fetch(request))
        );
    }
});
