// Network-first service worker — stays fresh online, works offline from cache.
const C = 'armada-v186';
const SHELL = ['/', '/index.html', '/kiosk.html', '/sl-kiosk.html', '/display.html', '/styles.css?v=20260622P', '/app.js?v=20260622P', '/logo.png', '/logo.svg', '/manifest.webmanifest'];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(C).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== C).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.pathname.startsWith('/api/')) return; // let the network handle the API
  // Offline fallback: serve the right shell for the surface (kiosk/display vs staff app).
  const fallback = u.pathname.startsWith('/sl-kiosk') ? '/sl-kiosk.html' : u.pathname.startsWith('/kiosk') ? '/kiosk.html' : u.pathname.startsWith('/display') ? '/display.html' : '/index.html';
  e.respondWith(
    fetch(e.request).then((r) => { const cp = r.clone(); caches.open(C).then((c) => c.put(e.request, cp)); return r; })
      .catch(() => caches.match(e.request).then((m) => m || caches.match(fallback)))
  );
});
