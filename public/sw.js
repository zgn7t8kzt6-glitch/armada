// Network-first service worker — stays fresh online, works offline from cache.
// Hardened: a bad/empty network response never poisons the cache or blanks the app,
// and a single missing asset never blocks the install.
const C = 'armada-v198';
const SHELL = ['/', '/index.html', '/kiosk.html', '/sl-kiosk.html', '/display.html', '/training.html', '/signup.html', '/styles.css?v=20260622AB', '/app.js?v=20260622AB', '/logo.png', '/logo.svg', '/manifest.webmanifest'];
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(C)
      // add each asset independently — one 404 must not fail the whole install
      .then((c) => Promise.allSettled(SHELL.map((u) => c.add(u))))
      .then(() => self.skipWaiting())
  );
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== C).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.pathname.startsWith('/api/')) return; // let the network handle the API
  const fallback = u.pathname.startsWith('/sl-kiosk') ? '/sl-kiosk.html' : u.pathname.startsWith('/kiosk') ? '/kiosk.html' : u.pathname.startsWith('/display') ? '/display.html' : u.pathname.startsWith('/signup') ? '/signup.html' : '/index.html';
  e.respondWith(
    fetch(e.request)
      .then((r) => {
        // Only cache genuine, complete responses. Never store an error/opaque/empty
        // body — that's what can leave the app blank after a deploy blip.
        if (r && r.ok && r.status === 200 && r.type === 'basic') {
          const cp = r.clone();
          caches.open(C).then((c) => c.put(e.request, cp));
          return r;
        }
        // bad response from the network → prefer a known-good cached copy if we have one
        return caches.match(e.request).then((m) => m || r);
      })
      .catch(() => caches.match(e.request).then((m) => m || caches.match(fallback)))
  );
});
