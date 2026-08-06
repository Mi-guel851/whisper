"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * A media query as a boolean, without the hydration mismatch.
 *
 * Same shape and same reasoning as `useSafeReducedMotion` — see that file for
 * why `useSyncExternalStore` rather than reading `matchMedia` during the first
 * client render. The server has no `matchMedia`, so `getServerSnapshot` returns
 * `false` for every query and the real answer arrives on the next render.
 *
 * That default is worth being deliberate about at each call site: whatever
 * `false` means for your query is what renders on the server and during
 * hydration. Phrase the query so `false` is the safe assumption.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (typeof window === "undefined" || !window.matchMedia) return () => {};
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    [query]
  );

  const getSnapshot = useCallback(() => {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return window.matchMedia(query).matches;
  }, [query]);

  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}

/**
 * True on touch devices — phones and tablets — false for mouse and trackpad.
 *
 * Used to decide whether an effect is affordable, not whether it's wanted. The
 * honest signal for "is this GPU going to struggle" would be device memory or a
 * benchmark, but pointer type correlates well enough in practice and is stable,
 * cheap, and already how the stylesheet makes the same call for hover states.
 *
 * Defaults to `false` (assume desktop) during hydration, so the richer path is
 * what renders server-side and a phone drops down to the cheap one a frame in.
 */
export function useCoarsePointer(): boolean {
  return useMediaQuery("(pointer: coarse)");
}

export default useMediaQuery;
