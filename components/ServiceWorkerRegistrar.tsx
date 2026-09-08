"use client";

import { useEffect } from "react";

/**
 * Installs the service worker, for everybody.
 *
 * WHY THIS EXISTS
 *
 * `public/sw.js` has been in the repo for a long time and almost nobody had it.
 * The only `register()` call lived inside `enablePushNotifications()` in
 * lib/push.ts — so the worker installed if, and only if, a user went looking for
 * the notifications toggle and turned it on. Everyone else ran with no worker at
 * all, which meant no cache: the app re-downloaded its entire bundle on every
 * launch and had nothing to show without a connection. The offline handling and
 * the caching strategy were both written and both unreachable.
 *
 * So registration moves here, unconditionally, and lib/push.ts now just waits for
 * whatever this installed.
 *
 * SECURITY BOUNDARY
 *
 * The worker caches only the static application shell. Supabase reads, API routes,
 * RSC payloads, and authenticated navigations are deliberately excluded by the
 * worker, so there is no private data cache to associate with a signed-in user.
 */
export default function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

    let cancelled = false;


    async function install() {
      try {
        await navigator.serviceWorker.register("/sw.js", { scope: "/" });
        if (cancelled) return;


      } catch {
        /* Registration is refused in a few real situations — a private window, a
           WebView built without service worker support, an insecure origin. None
           of them are errors the user can act on, and the app works without it. */
      }
    }

    /*
     * Deferred past first paint. Installing pulls the whole precache list over
     * the network, and doing that while the first screen is still rendering makes
     * the launch this is meant to speed up measurably slower.
     */
    const idle = window as Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (handle: number) => void;
    };

    let idleHandle: number | undefined;
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

    if (typeof idle.requestIdleCallback === "function") {
      idleHandle = idle.requestIdleCallback(() => void install(), { timeout: 4000 });
    } else {
      timeoutHandle = setTimeout(() => void install(), 1500);
    }



    return () => {
      cancelled = true;
      if (idleHandle !== undefined && typeof idle.cancelIdleCallback === "function") {
        idle.cancelIdleCallback(idleHandle);
      }
      if (timeoutHandle) clearTimeout(timeoutHandle);
    };
  }, []);

  return null;
}
