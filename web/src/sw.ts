// Service worker — bundled by Vite (lives in src/, not public/) so build-time
// constants like __APP_VERSION__ are replaced by the compiler, not by a
// string-replacement script. The cache name carries the app version from
// package.json (single source of truth).

/// <reference lib="webworker" />
declare const __APP_VERSION__: string;
declare let self: ServiceWorkerGlobalScope;

const CACHE = `qr-scanner-v${__APP_VERSION__}`;
const ASSETS = ['/', '/index.html', '/manifest.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
    ).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  // App shell: network-first for navigations (index.html must stay fresh —
  // hashed asset filenames make everything else cache-safe), cache-first
  // for the rest.
  if (req.mode === 'navigate' || new URL(req.url).pathname === '/index.html') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put('/index.html', copy));
          return res;
        })
        .catch(() => caches.match('/index.html').then((m) => m ?? Response.error())),
    );
    return;
  }
  event.respondWith(
    caches.match(req).then((cached) =>
      cached || fetch(req).then((res) => {
        if (res && res.ok && new URL(req.url).origin === self.location.origin) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      }),
    ),
  );
});
