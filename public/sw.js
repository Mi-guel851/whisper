/*
 * Whisper service worker.
 *
 * Two jobs: make the app open instantly and keep it usable with no connection.
 * Both come down to one idea — route by what a request *is*, rather than running
 * one strategy over everything.
 *
 *
 * WHY THE PREVIOUS VERSION MADE THE APP SLOWER THAN THE WEBSITE
 *
 * It was network-first for every GET. That is exactly backwards for the bulk of
 * what a launch downloads: files under /_next/static carry a content hash in
 * their name, so they can never change meaning — yet every cold start re-fetched
 * all of them and only used the cache once the network had already failed. The
 * Android shell loads from the network to begin with (capacitor.config.ts points
 * `server.url` at the deployment), so that re-fetch was the launch time.
 *
 * It also had no timeout, which is the worse half. `fetch()` on one bar does not
 * fail — it hangs. A network-first handler with no deadline therefore turns a bad
 * connection into a frozen app, while a perfectly good cached copy sits unused.
 *
 *
 * WHAT MUST NEVER BE CACHED, AND WHY THAT IS A SECURITY LINE
 *
 * The old handler cached any `ok` GET into one shared cache, including
 * cross-origin Supabase reads. A Cache API key is the request URL — headers are
 * not part of it — so two accounts on the same phone issue byte-identical URLs
 * for "my conversations" and differ only in an Authorization header the cache
 * ignores. Signing out and signing in as someone else would serve the first
 * account's rows to the second.
 *
 * So data lives in its own cache, that cache is dropped whenever the signed-in
 * user changes (the page messages us — see components/ServiceWorkerRegistrar),
 * and /api/** plus everything under Supabase's /auth/** is never stored at all.
 * Writes are left alone entirely: a queued write that lands hours later is worse
 * than one that plainly failed.
 */

const SHELL_CACHE = "whisper-shell-v4";
const DATA_CACHE = "whisper-data-v1";
const OFFLINE_URL = "/offline.html";

/** Past this, a cached copy beats waiting. See the note above about one bar. */
const NAVIGATION_TIMEOUT_MS = 2500;
const DATA_TIMEOUT_MS = 4000;

/*
 * The routes worth having before they are first visited. Precaching a shell is
 * cheap — an App Router page for a client component is a small HTML document and
 * the real weight is the shared JS bundle, which is cached once for all of them.
 *
 * Added individually below rather than with `addAll`, which rejects atomically:
 * the previous version had two URLs in this list that do not exist in an App
 * Router build, so one 404 meant *nothing* was ever precached and offline mode
 * silently never worked at all.
 */
const SHELL_ROUTES = [
  "/",
  "/dashboard",
  "/inbox",
  "/public-feed",
  "/discover",
  "/profile",
  "/premium",
  "/notifications",
  "/friends",
  "/settings",
  "/appearance",
  "/analytics",
  "/games",
  "/saved-messages",
  "/blocklist",
];

const SHELL_ASSETS = [OFFLINE_URL, "/ghost.png", "/favicon.ico"];

/* ------------------------------------------------------------------------- *
 * Install / activate
 * ------------------------------------------------------------------------- */

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      await Promise.all(
        [...SHELL_ASSETS, ...SHELL_ROUTES].map((url) =>
          cache.add(new Request(url, { cache: "reload" })).catch(() => {
            /* A route that 404s or redirects is skipped, not fatal. */
          })
        )
      );
    })()
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name !== SHELL_CACHE && name !== DATA_CACHE)
          .map((name) => caches.delete(name))
      );

      /* Serve the fresh shell to tabs that are already open, so a deploy does
         not leave a half-updated app running until the next cold start. */
      await self.clients.claim();
    })()
  );
});

/* ------------------------------------------------------------------------- *
 * Cache ownership
 * ------------------------------------------------------------------------- */

/*
 * The page tells us who is signed in. Anything cached for a different account is
 * dropped on the spot — see the security note at the top of this file. Kept in a
 * variable *and* in the cache so a restarted worker still knows whose data it is
 * holding; a worker is killed and respawned freely between events.
 */
let cachedUserId = null;

async function rememberUser(userId) {
  const cache = await caches.open(DATA_CACHE);
  const marker = await cache.match("/__whisper_cache_owner");
  const previous = marker ? await marker.text() : null;

  if (previous && previous !== userId) {
    await caches.delete(DATA_CACHE);
  }

  cachedUserId = userId;

  if (userId) {
    const fresh = await caches.open(DATA_CACHE);
    await fresh.put("/__whisper_cache_owner", new Response(userId));
  }
}

self.addEventListener("message", (event) => {
  const data = event.data || {};

  if (data.type === "WHISPER_USER") {
    event.waitUntil(rememberUser(data.userId || null));
    return;
  }

  /* Sign-out. Everything personal goes; the shell stays, because the next
     person to open the app still wants it to start instantly. */
  if (data.type === "WHISPER_SIGNED_OUT") {
    cachedUserId = null;
    event.waitUntil(caches.delete(DATA_CACHE));
  }
});

/* ------------------------------------------------------------------------- *
 * Strategies
 * ------------------------------------------------------------------------- */

/** A fetch that gives up, so a stalled connection cannot stall the app. */
function fetchWithTimeout(request, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), timeoutMs);
    fetch(request)
      .then((response) => {
        clearTimeout(timer);
        resolve(response);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

/*
 * Immutable assets: answer from cache and never revalidate.
 *
 * Safe precisely because the filename contains a content hash — a changed file
 * is a changed URL, so a stale hit is impossible rather than merely unlikely.
 * This is the single biggest launch-speed win available here.
 */
async function cacheFirst(request) {
  const cache = await caches.open(SHELL_CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;

  try {
    const response = await fetch(request);
    if (response.ok || response.type === "opaque") {
      await cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response("", { status: 504, statusText: "Offline" });
  }
}

/** Fresh when possible, last-known when not. */
async function networkFirst(request, cacheName, timeoutMs, fallback) {
  const cache = await caches.open(cacheName);

  try {
    const response = await fetchWithTimeout(request, timeoutMs);
    if (response.ok) {
      await cache.put(request, response.clone());
    }
    return response;
  } catch {
    const hit = await cache.match(request);
    if (hit) return hit;
    if (fallback) {
      const offline = await caches.open(SHELL_CACHE).then((c) => c.match(fallback));
      if (offline) return offline;
    }
    /* Always a real Response. The previous version returned `null` here, which
       is not a valid `respondWith` value — it threw a TypeError, so the request
       failed as a worker error instead of a clean offline response. */
    return new Response("", { status: 504, statusText: "Offline" });
  }
}

/* ------------------------------------------------------------------------- *
 * Routing
 * ------------------------------------------------------------------------- */

/*
 * Same-origin only, deliberately.
 *
 * An earlier draft matched image extensions on any host, which quietly took in
 * Supabase Storage. Those are signed URLs: the token lives in the query string
 * and rotates, so every fresh signature is a new cache key for bytes already
 * held — a cache that grows without bound and never serves a hit. Cross-origin
 * media is left to the browser's own HTTP cache, which handles it correctly.
 */
function isImmutableAsset(url) {
  if (url.origin !== self.location.origin) return false;
  return (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/_next/image") ||
    /\.(?:woff2?|ttf|otf|png|jpe?g|svg|webp|avif|ico)$/i.test(url.pathname)
  );
}

/*
 * `next/link` does not fetch HTML — it fetches an RSC payload, flagged either by
 * the `RSC` request header or an `_rsc` query parameter. Miss these and offline
 * client-side navigation fails: the router rejects, and only a full reload
 * (which the shell cache does answer) gets anywhere.
 */
function isRscRequest(request, url) {
  return request.headers.get("RSC") === "1" || url.searchParams.has("_rsc");
}

function isSupabaseRead(request, url) {
  return (
    request.method === "GET" &&
    url.hostname.endsWith(".supabase.co") &&
    url.pathname.startsWith("/rest/v1/")
  );
}

self.addEventListener("fetch", (event) => {
  const request = event.request;

  /* Writes are never intercepted — they must reach the network or fail
     honestly. Nothing here queues or replays them. */
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  /* Auth is never cached: a replayed token exchange is a security problem, not
     a convenience. Realtime is a WebSocket and not ours to handle. */
  if (url.hostname.endsWith(".supabase.co")) {
    if (url.pathname.startsWith("/auth/") || url.pathname.startsWith("/realtime/")) return;
  }

  /* Server routes hold coin spends, view-once receipts and admin actions. A
     cached answer to any of them would be a lie about something that has real
     consequences, so they are left entirely alone. */
  if (url.origin === self.location.origin && url.pathname.startsWith("/api/")) return;

  if (isImmutableAsset(url)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  if (isSupabaseRead(request, url)) {
    /* Anonymous reads are not stored — there is no user to scope them to, so the
       account-isolation guarantee above could not be kept. */
    if (!cachedUserId) return;
    event.respondWith(networkFirst(request, DATA_CACHE, DATA_TIMEOUT_MS, null));
    return;
  }

  /* Only our own origin past here. Cross-origin images, DiceBear avatars and the
     like are left to the browser's own HTTP cache. */
  if (url.origin !== self.location.origin) return;

  if (isRscRequest(request, url)) {
    event.respondWith(networkFirst(request, SHELL_CACHE, NAVIGATION_TIMEOUT_MS, null));
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request, SHELL_CACHE, NAVIGATION_TIMEOUT_MS, OFFLINE_URL));
  }
});

/* ------------------------------------------------------------------------- *
 * Web push — unchanged behaviour
 * ------------------------------------------------------------------------- */

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    /* A payload that is not JSON still deserves a notification. */
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
    self.clients.matchAll({ type: "window" }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(url) && "focus" in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
