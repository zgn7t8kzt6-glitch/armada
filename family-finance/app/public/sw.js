// Offline = read-only snapshot (SPEC-PHASE1.md 6.6). Caches GET pages as you
// browse; serves the cache when offline; never queues money movement.
const CACHE = 'familyos-v1';
self.addEventListener('install', e => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(clients.claim()));
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return; // writes require a connection
  e.respondWith(
    fetch(e.request).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
      return res;
    }).catch(() =>
      caches.match(e.request).then(hit => hit || caches.match('/offline'))
    )
  );
});
