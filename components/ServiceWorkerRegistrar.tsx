"use client";

import { useEffect } from "react";
import { supabase } from "@/lib/supabase/client";

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
 * WHY IT ALSO WATCHES AUTH
 *
 * The Cache API keys entries by URL. Request headers are not part of the key, and
 * a Supabase read differs between two accounts *only* by its Authorization
 * header — so "my conversations" is a byte-identical URL for everybody. Left
 * alone, signing out and signing in as someone else on the same phone would serve
 * the previous account's rows from cache.
 *
 * The worker cannot see who is signed in; only the page can. So the page tells
 * it, on every auth change, and the worker drops its data cache whenever the
 * answer differs from what it was holding. That message is the whole reason this
 * component subscribes to auth rather than firing once and unmounting.
 */
export default function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

    let cancelled = false;

    /** Tell the active worker who it is caching for. */
    async function announce(userId: string | null) {
      try {
        const registration = await navigator.serviceWorker.ready;
        const worker = registration.active;
        if (!worker) return;
        worker.postMessage(
          userId
            ? { type: "WHISPER_USER", userId }
            : { type: "WHISPER_SIGNED_OUT" }
        );
      } catch {
        /* No worker yet, or the browser refused. Caching simply does not happen,
           which is a degraded experience rather than a broken one. */
      }
    }

    async function install() {
      try {
        await navigator.serviceWorker.register("/sw.js", { scope: "/" });
        if (cancelled) return;

        const { data } = await supabase.auth.getSession();
        await announce(data.session?.user?.id ?? null);
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

    /* Sign-in, sign-out and token refresh all land here. A refresh re-announces
       the same id, which the worker treats as a no-op. */
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      void announce(session?.user?.id ?? null);
    });

    return () => {
      cancelled = true;
      if (idleHandle !== undefined && typeof idle.cancelIdleCallback === "function") {
        idle.cancelIdleCallback(idleHandle);
      }
      if (timeoutHandle) clearTimeout(timeoutHandle);
      listener.subscription.unsubscribe();
    };
  }, []);

  return null;
}
