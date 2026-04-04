// Self-destruct SW — unregister and clear all caches
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(names => Promise.all(names.map(n => caches.delete(n))))
    .then(() => self.clients.claim())
    .then(() => self.registration.unregister())
  );
});
// Don't intercept any fetches — let browser handle everything
