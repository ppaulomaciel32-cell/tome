// Retire the former cache so visitors cannot keep stale consent or security code.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(key => key.startsWith("tome-nota-shell-")).map(key => caches.delete(key))
  )).then(() => self.clients.claim()).then(() => self.registration.unregister()));
});

