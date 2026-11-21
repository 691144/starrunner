// STARRUNNER service worker: precache the app shell, cache fonts at runtime, work fully offline.
const VERSION = 'starrunner-v3';
const DEV = ['localhost', '127.0.0.1'].includes(self.location.hostname);
const SHELL = [
  './',
  './index.html',
  './styles.css',
  './manifest.webmanifest',
  './vendor/three.module.min.js',
  './js/main.js',
  './js/game.js',
  './js/trench.js',
  './js/course.js',
  './js/fx.js',
  './js/ship.js',
  './js/audio.js',
  './js/input.js',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Google Fonts: stale-while-revalidate
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(caches.open(VERSION + '-fonts').then(async c => {
      const hit = await c.match(req);
      const net = fetch(req).then(r => { if (r.ok || r.type === 'opaque') c.put(req, r.clone()); return r; }).catch(() => hit);
      return hit || net;
    }));
    return;
  }
  if (url.origin !== location.origin) return;

  // navigations: network first so updates land, fall back to cached shell offline
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then(r => {
      const copy = r.clone();
      caches.open(VERSION).then(c => c.put('./index.html', copy));
      return r;
    }).catch(() => caches.match('./index.html')));
    return;
  }

  const fromNet = () => fetch(req).then(r => {
    if (r.ok) { const copy = r.clone(); caches.open(VERSION).then(c => c.put(req, copy)); }
    return r;
  });
  // local dev: network first (fresh edits), cache as offline fallback
  if (DEV) { e.respondWith(fromNet().catch(() => caches.match(req, { ignoreSearch: true }))); return; }
  // production: cache first, then network (and cache it)
  e.respondWith(caches.match(req, { ignoreSearch: true }).then(hit => hit || fromNet()));
});
