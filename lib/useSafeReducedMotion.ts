"use client";

import { useSyncExternalStore } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

function subscribe(onChange: () => void) {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const mql = window.matchMedia(QUERY);
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}

function getSnapshot() {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia(QUERY).matches;
}

/**
 * The server has no `matchMedia`, so it can only ever assume "motion allowed".
 * Returning that same answer for the hydration render is the point: React
 * compares this pass against the server HTML, and any disagreement is a
 * mismatch.
 */
function getServerSnapshot() {
  return false;
}

/**
 * `prefers-reduced-motion`, without the hydration mismatch.
 *
 * Framer's own `useReducedMotion()` reads the media query synchronously on the
 * first client render. For a user who *has* reduced motion enabled that render
 * disagrees with the server's — and since components branch on it to decide
 * `initial` transforms, `className`s, and whether decorative elements mount at
 * all, React throws away the server tree and re-renders the page.
 *
 * `useSyncExternalStore` is built for exactly this: it renders the server
 * snapshot during hydration, then immediately re-renders with the real one.
 * The preference is honoured a frame later instead of a frame too early.
 *
 * Use this everywhere instead of importing `useReducedMotion` from
 * framer-motion.
 */
export function useSafeReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export default useSafeReducedMotion;
