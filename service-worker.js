// Network-first for the app's own files (so updates show up on the next open, no cache-busting
// needed) with the cache as the offline fallback. Firebase's SDK scripts are cached cache-first so
// sync can start while offline. Calls to the Claude API and Firestore are never intercepted.

const CACHE_NAME = 'simple-budget-v1';
const SHELL_FILES = [
  './', './index.html', './style.css', './app.js', './store.js', './claude.js',
  './manifest.json', './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png',
  './img/bg-dining.jpg', './img/bg-groceries.jpg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.hostname === 'www.gstatic.com' && url.pathname.startsWith('/firebasejs/')) {
    event.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        const clone = res.clone();
        caches.open(CACHE_NAME).then((c) => c.put(req, clone));
        return res;
      }))
    );
    return;
  }

  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(req, { cache: 'no-cache' }).then((res) => {
      const clone = res.clone();
      caches.open(CACHE_NAME).then((c) => c.put(req, clone));
      return res;
    }).catch(() => caches.match(req).then((hit) => hit || caches.match('./index.html')))
  );
});
