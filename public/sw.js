const CACHE_NAME = "whisper-cache-v3";

// Only URLs that actually resolve. `/globals.css` and `/index.html` were in
// this list but neither exists in an App Router build — CSS is emitted under
// /_next with a content hash, and there is no index.html. That mattered more
// than a 404 in the log: `cache.addAll` rejects atomically, so one bad entry
// meant *nothing* was ever precached and offline mode never worked.
const STATIC_ASSETS = ["/", "/ghost.png", "/favicon.ico", "/offline.html"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      // Individually, so a single missing asset can't take the whole
      // installation down with it again.
      Promise.all(
        STATIC_ASSETS.map((url) =>
          cache
            .add(url)
            .catch((error) => console.warn("[sw] precache skipped", url, error))
        )
      )
    )
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    })
  );
  self.clients.claim();
});

// Logic to handle offline navigation
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const request = event.request;

  event.respondWith(
    fetch(request)
      .then((networkResponse) => {
        // If successful, cache the response
        if (networkResponse.ok) {
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, responseClone));
        }
        return networkResponse;
      })
      .catch(() => {
        // If network fails, try the cache
        return caches.match(request).then((cachedResponse) => {
          if (cachedResponse) return cachedResponse;

          // If it's a navigation request and not in cache, show offline.html
          if (request.mode === "navigate") {
            return caches.match("/offline.html");
          }

          return null;
        });
      })
  );
});

// Push Notification Logic
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    console.error("Push data error", e);
  }

  const title = data.title || "Whisper";
  const options = {
    body: data.body || "You got a new anonymous message 👻",
    icon: "/ghost.png",
    badge: "/ghost.png",
    data: { url: data.url || "/dashboard" },
    vibrate: [100, 50, 100],
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/dashboard";
  event.waitUntil(
    clients.matchAll({ type: "window" }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(url) && "focus" in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});