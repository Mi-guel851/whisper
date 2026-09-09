"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

/**
 * Feeds the service worker's last-visit snapshots.
 *
 * WHAT A SNAPSHOT IS
 *
 * The rendered DOM of the current route, serialized with every <script> removed
 * and posted to the worker, which stores it per route (public/sw.js). Restored,
 * it is a static picture of exactly what was on screen — messages, feed posts,
 * balances — not a live app. That is deliberate: it exists to answer "show me
 * where I was last" when a navigation cannot be served live, and a picture is
 * both the honest and the cheap answer.
 *
 * WHY THE DOM AND NOT THE SERVER HTML
 *
 * Most lists in this app are filled by client-side fetches after hydration, so
 * the SSR document the worker already caches is a page of skeletons. The useful
 * preview only exists once the data has rendered, which is a state only the
 * living page can observe. Hence this component rather than a worker-side copy
 * of the navigation response.
 *
 * WHEN CAPTURE HAPPENS
 *
 * Twice per route: once the route has been on screen long enough to have
 * fetched and painted (SETTLE_MS), and again as the page is hidden or unloaded,
 * which is the moment a capture is most complete and most likely to be the
 * "last visit" someone comes back to. Duplicates are skipped by comparing the
 * serialized string, so the common case — nothing changed in between — costs
 * one comparison and no cache write.
 *
 * WHAT IS DELIBERATELY LEFT OUT
 *
 * Scripts (a restored preview must not re-execute the app), overlays such as
 * modals and toasts (frozen mid-flight they would cover the very page being
 * previewed), anything opted out with `data-snapshot-exclude`, and documents
 * above MAX_SNAPSHOT_CHARS — a snapshot that costs megabytes to store is a tax
 * on every save, and a chat scrolled into the thousands of nodes is not worth
 * previewing pixel-for-pixel.
 */

const SETTLE_MS = 2200;
const MAX_SNAPSHOT_CHARS = 1_500_000;

function serialize(): string | null {
  const clone = document.documentElement.cloneNode(true) as HTMLElement;

  clone.querySelectorAll("script").forEach((node) => node.remove());
  clone
    .querySelectorAll(
      '[data-snapshot-exclude], [data-sw-restore-note], [role="dialog"], [role="alertdialog"], [role="alert"], [role="status"]'
    )
    .forEach((node) => node.remove());

  const html = "<!DOCTYPE html>\n" + clone.outerHTML;
  return html.length > MAX_SNAPSHOT_CHARS ? null : html;
}

export default function PageSnapshotter() {
  const pathname = usePathname();
  const lastPosted = useRef<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;

    function capture() {
      const controller = navigator.serviceWorker?.controller;
      if (!controller) return;

      const path = window.location.pathname;
      if (!path.startsWith("/") || path.startsWith("/api")) return;

      let html: string | null = null;
      try {
        html = serialize();
      } catch {
        /* A DOM that cannot be cloned is not worth an error report. */
        return;
      }
      if (!html || html === lastPosted.current) return;

      lastPosted.current = html;
      controller.postMessage({ type: "save-snapshot", path, html, at: Date.now() });
    }

    const settle = setTimeout(capture, SETTLE_MS);

    function onVisibilityChange() {
      if (document.visibilityState === "hidden") capture();
    }
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pagehide", capture);

    return () => {
      clearTimeout(settle);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pagehide", capture);
    };
  }, [pathname]);

  return null;
}
