/*
 * Whisper service worker.
 *
 * Three jobs: make the app open instantly, keep it usable with no connection,
 * and — the reason this revision exists — never strand somebody on a dead-end
 * screen while their own device is already holding the page they were looking
 * at.
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
 * WHY THERE IS NO "RECONNECTING" SCREEN ANY MORE
 *
 * The old navigation handler raced the network for 2.5s and, when the race was
 * lost, answered with `/offline.html` — the ghost page that says "Reconnecting…
 * still offline — watching for a connection". Two things made that page appear to
 * people who were perfectly online:
 *
 *   1. 2.5s is shorter than a cold serverless boot. A first hit on a slept
 *      Vercel function routinely exceeds it, so the app "went offline" for
 *      exactly as long as the server took to wake up.
 *   2. The fallback fired whenever the *requested route* had no cache entry —
 *      and only ~15 shell routes are precached. /signup, /chat/<id>, /u/<handle>
 *      and everything else had nothing to fall back to except the ghost page.
 *
 * Both are now handled by last-visit snapshots instead. While the app is open,
 * the page serializes its own rendered DOM (scripts stripped) and hands it here;
 * it is stored per route in SNAPSHOT_CACHE. When a navigation cannot be served
 * live — slow, failed, or fully offline — the chain is:
 *
 *   snapshot of this route  →  most recent snapshot of any route  →
 *   cached document for this route  →  precached shell  →  wait for the network
 *
 * A served snapshot is a static preview of exactly what was on screen last, with
 * a small honest note and a probe that reloads the moment the server answers, so
 * a slow-but-alive connection upgrades itself into the live page. The ghost page
 * is gone from this file entirely: it remains on disk only as Capacitor's
 * `errorPath`, for the native shell's one truly-cacheless moment (first launch,
 * no worker, no network), and it no longer claims anybody is offline.
 *
 *
 * WHAT MUST NEVER BE CACHED, AND WHY THAT IS A SECURITY LINE
 *
 * An earlier handler cached any `ok` GET into one shared cache, including
 * cross-origin Supabase reads. A Cache API key is the request URL — headers are
 * not part of it — so two accounts on the same phone issue byte-identical URLs
 * for "my conversations" and differ only in an Authorization header the cache
 * ignores. Signing out and signing in as someone else would serve the first
 * account's rows to the second.
 *
 * So Supabase REST reads, /api/** and auth endpoints are still never stored.
 * Snapshots ARE private rendered HTML, which puts them on the same side of that
 * line as the data they depict — so the snapshot cache is dropped wholesale on
 * every sign-out and every switch between accounts (the page messages us; see
 * components/ServiceWorkerRegistrar), and it is capped at a handful of routes
 * rather than grown into a second browsing history.
 */

const SHELL_CACHE = "whisper-shell-v6";
const SNAPSHOT_CACHE = "whisper-snapshot-v1";

/** Past this, a cached copy or a snapshot beats waiting. See the note above. */
const NAVIGATION_TIMEOUT_MS = 2500;

/** Snapshots are a preview, not an archive. Oldest beyond this count are pruned. */
const MAX_SNAPSHOTS = 8;

/* Snapshots live under a synthetic prefix so they can never collide with a real
   route, and are only ever addressed from inside this worker. */
const SNAPSHOT_PREFIX = "/__snapshot";

/*
 * The routes worth having before they are first visited. Precaching a shell is
 * cheap — an App Router page for a client component is a small HTML document and
 * the real weight is the shared JS bundle, which is cached once for all of them.
 *
 * The auth routes are here because they are the ones a cold, half-attached
 * connection hits first: opening the app signed-out is a navigation to /login or
 * /signup, and that is precisely the case that used to end on the ghost page.
 *
 * Added individually below rather than with `addAll`, which rejects atomically:
 * a previous version had two URLs in this list that do not exist in an App
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
  "/login",
  "/signup",
];

const SHELL_ASSETS = ["/ghost.png", "/favicon.ico"];

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
          .filter((name) => name !== SHELL_CACHE && name !== SNAPSHOT_CACHE)
          .map((name) => caches.delete(name))
      );

      /* Serve the fresh shell to tabs that are already open, so a deploy does
         not leave a half-updated app running until the next cold start. */
      await self.clients.claim();
    })()
  );
});

/* ------------------------------------------------------------------------- *
 * Last-visit snapshots
 * ------------------------------------------------------------------------- *
 * The page posts { type: "save-snapshot", path, html, at } once a route has
 * settled, and again as it is hidden — see components/PageSnapshotter. What is
 * stored is the rendered DOM with its scripts removed: restoring it therefore
 * replays what the screen *looked like*, not a live app, which is exactly what
 * "show me where I was" means.
 */

function snapshotRequestFor(path) {
  return new Request(new URL(SNAPSHOT_PREFIX + path, self.location.origin));
}

async function pruneSnapshots(cache) {
  const keys = await cache.keys();
  const dated = [];
  for (const key of keys) {
    const entry = await cache.match(key);
    dated.push({ key, at: Number(entry?.headers.get("x-snapshot-at")) || 0 });
  }
  dated.sort((a, b) => b.at - a.at);
  await Promise.all(
    dated.slice(MAX_SNAPSHOTS).map((entry) => cache.delete(entry.key))
  );
}

async function latestSnapshot() {
  const cache = await caches.open(SNAPSHOT_CACHE);
  const keys = await cache.keys();

  let best = null;
  let bestAt = 0;
  for (const key of keys) {
    const entry = await cache.match(key);
    if (!entry) continue;
    const at = Number(entry.headers.get("x-snapshot-at")) || 0;
    if (at >= bestAt) {
      bestAt = at;
      best = entry;
    }
  }
  return best;
}

/*
 * The note injected into a served snapshot. Two jobs: say plainly that this is
 * a previous visit rather than live data — the same honesty the in-app offline
 * pill exists for — and upgrade itself away. The probe HEADs the very URL on
 * screen; the instant the server answers it, the preview reloads into the real
 * page. Backoff keeps a genuinely dead server from turning into a reload loop.
 */
const RESTORE_NOTE = `
<div data-sw-restore-note style="position:fixed;left:50%;transform:translateX(-50%);bottom:calc(14px + env(safe-area-inset-bottom,0px));z-index:2147483647;display:flex;align-items:center;gap:8px;max-width:calc(100vw - 32px);padding:9px 14px;border-radius:999px;border:1px solid rgba(148,163,184,0.25);background:rgba(10,6,26,0.92);color:#cbd5e1;font:600 12px/1.3 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;letter-spacing:0.02em;box-shadow:0 10px 28px -10px rgba(0,0,0,0.7);pointer-events:none;">
  <span style="flex:none;width:6px;height:6px;border-radius:999px;background:#a78bfa;"></span>
  <span>Your last visit — it refreshes itself the moment the server answers</span>
</div>
<script>
(function () {
  var tries = 0;
  function probe() {
    var control = new AbortController();
    var timer = setTimeout(function () { control.abort(); }, 4000);
    fetch(location.href, { method: "HEAD", cache: "no-store", signal: control.signal })
      .then(function (response) {
        clearTimeout(timer);
        if (response && response.ok) { location.reload(); } else { retry(); }
      })
      .catch(function () {
        clearTimeout(timer);
        retry();
      });
  }
  function retry() {
    tries += 1;
    if (tries < 60) setTimeout(probe, tries < 6 ? 3000 : 8000);
  }
  setTimeout(probe, 3000);
})();
</script>`;

/** Rewrap a stored snapshot so the address bar keeps the requested URL, and
 *  stitch in the restore note just before </body>. */
async function serveSnapshot(entry) {
  const body = await entry.text();
  const at = body.lastIndexOf("</body>");
  const html = at === -1 ? body : body.slice(0, at) + RESTORE_NOTE + body.slice(at);

  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "x-whisper-snapshot": entry.headers.get("x-snapshot-path") || "1",
    },
  });
}

self.addEventListener("message", (event) => {
  const data = event.data;
  if (!data || typeof data !== "object") return;

  if (
    data.type === "save-snapshot" &&
    typeof data.path === "string" &&
    typeof data.html === "string"
  ) {
    const path = data.path.startsWith("/") ? data.path : "/" + data.path;
    const at = Number(data.at) || Date.now();

    event.waitUntil(
      caches.open(SNAPSHOT_CACHE).then(async (cache) => {
        await cache.put(
          snapshotRequestFor(path),
          new Response(data.html, {
            headers: {
              "Content-Type": "text/html; charset=utf-8",
              "x-snapshot-at": String(at),
              "x-snapshot-path": path,
            },
          })
        );
        await pruneSnapshots(cache);
      })
    );
    return;
  }

  /* Sign-out or account switch: a snapshot is private rendered HTML, so it dies
     with the session that produced it. */
  if (data.type === "clear-snapshots") {
    event.waitUntil(caches.delete(SNAPSHOT_CACHE));
  }
});

/* ------------------------------------------------------------------------- *
 * Strategies
 * ------------------------------------------------------------------------- */

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

/*
 * Last-known content for a navigation that cannot be served live right now.
 *
 * Order matters. A rendered snapshot of the very route beats everything because
 * it is what was actually on screen; the newest snapshot of any route is next,
 * because "where I was last" is still a better answer than a skeleton; only
 * then do the unrendered shells of this same route come in, as a floor for a
 * device that has never captured anything.
 *
 * Deliberately no front-door floor: answering an unknown route with the
 * marketing landing page would show a connected-but-slow user a page they
 * never asked for. Returns null when the device holds nothing for this route,
 * and the caller then waits on the real network — or, if it is dead, lets the
 * browser show its own honest error.
 */
async function navigationFallback(request, url) {
  const snapshotCache = await caches.open(SNAPSHOT_CACHE);

  const own = await snapshotCache.match(snapshotRequestFor(url.pathname));
  if (own) return serveSnapshot(own);

  const latest = await latestSnapshot();
  if (latest) return serveSnapshot(latest);

  const shell = await caches.open(SHELL_CACHE);

  const exact = await shell.match(request, { ignoreSearch: true });
  if (exact) return exact;

  if (SHELL_ROUTES.includes(url.pathname)) {
    const route = await shell.match(new Request(url.origin + url.pathname));
    if (route) return route;
  }

  return null;
}

/*
 * Navigations: the network gets the first word and the cache gets the last.
 *
 * The 2.5s deadline no longer means "give up and show a dead end". It means
 * "if the server has not answered by now, show the last visit while it keeps
 * trying" — the live request stays in flight either way, and its response is
 * written to the shell cache for the next launch even when nobody ever sees it.
 *
 * When the network *errors* rather than merely stalls, the same chain runs.
 * Only a device with nothing cached at all is left waiting on the bare request,
 * in which case the browser's own error page is the honest answer — there is no
 * last visit to show.
 */
function navigationStrategy(request, url) {
  const cacheable =
    !request.headers.get("authorization") && !request.headers.get("cookie");

  const networkPromise = fetch(request).then(async (response) => {
    if (cacheable && response.ok) {
      try {
        const cache = await caches.open(SHELL_CACHE);
        await cache.put(request, response.clone());
      } catch {
        /* A quota-full cache is not worth failing a navigation over. */
      }
    }
    return response;
  });

  /* A settled twin that never rejects, so the timer path below can always race
     against "has the network finished, either way". */
  const settled = networkPromise.catch(() => null);

  return new Promise((resolve) => {
    const timer = setTimeout(async () => {
      const fallback = await navigationFallback(request, url);
      /* Resolve to the live request when there is nothing to fall back to: a
         slow connection that eventually delivers is still a success. */
      resolve(fallback || networkPromise);
    }, NAVIGATION_TIMEOUT_MS);

    settled.then((response) => {
      clearTimeout(timer);
      if (response) {
        resolve(response);
        return;
      }
      navigationFallback(request, url).then((fallback) =>
        resolve(fallback || networkPromise)
      );
    });
  });
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

  /* Supabase REST reads are never cached. They may contain private messages,
     profile details, balances, or admin data, and URL keys do not include auth
     headers. */
  if (url.hostname.endsWith(".supabase.co")) return;

  /* Only our own origin past here. Cross-origin images, DiceBear avatars and
     the like are left to the browser's own HTTP cache. */
  if (url.origin !== self.location.origin) return;

  if (isRscRequest(request, url)) {
    /* RSC payloads can contain private server-rendered data. Let the browser
       retry them normally; the already-cached document/static chunks still make
       the app shell visible on a cold offline launch. */
    return;
  }

  if (request.mode === "navigate") {
    /* Do not store requests carrying session credentials. Public shell documents
       are safe to keep; private HTML is not. (Snapshots of private pages arrive
       through the message channel instead, and are wiped with the session.) */
    if (request.headers.get("authorization") || request.headers.get("cookie")) return;
    event.respondWith(navigationStrategy(request, url));
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
