"use client";

import { useCallback, useRef, useState, useSyncExternalStore } from "react";

/**
 * Remembered position for a floating button the user can drag.
 *
 * WHY THE STORED VALUE IS A FRACTION, NOT A PIXEL OFFSET
 *
 * A button parked against the right edge of a phone has to still be against the
 * right edge after a rotation, on a tablet, and in a resized desktop window. Pixel
 * offsets do not survive any of those: 320px from the left is a right-edge button
 * on a phone and a centred one on a laptop, and a saved `bottom: 700px` puts the
 * control off-screen entirely on the next device. So what persists is where the
 * button sits *proportionally* in the free area, and pixels are derived from that
 * against the live viewport on every read.
 *
 * WHY IT SNAPS TO A SIDE
 *
 * A draggable control left in the middle of the screen covers content and reads as
 * dropped rather than placed. Snapping to the nearer vertical edge on release is
 * what makes it feel like it has a home — the same thing iOS does with AssistiveTouch
 * and Android with bubble notifications. Only the horizontal axis snaps; vertical
 * stays exactly where it was let go, because that is the axis the user is actually
 * choosing when they move a button up out of the way of something.
 */

export type FabAnchor = {
  /** 0 = left edge, 1 = right edge. Snapped, so in practice one or the other. */
  x: number;
  /** 0 = top of the draggable band, 1 = bottom. */
  y: number;
};

type Options = {
  /** Distinguishes one draggable control's memory from another's. */
  storageKey: string;
  /** Where it lives before anybody has moved it. */
  fallback: FabAnchor;
  /** Button's own size, so it can be kept fully on screen. */
  size: number;
  /** Keep-out at the top (status bar, pinned chrome). */
  insetTop: number;
  /** Keep-out at the bottom (tab bar, home indicator). */
  insetBottom: number;
  /** Keep-out at the sides. */
  insetX: number;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function readAnchor(storageKey: string, fallback: FabAnchor): FabAnchor {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as unknown;
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof (parsed as FabAnchor).x !== "number" ||
      typeof (parsed as FabAnchor).y !== "number"
    ) {
      return fallback;
    }
    const { x, y } = parsed as FabAnchor;
    /* A NaN that reached storage would render the button at `translate(NaN)` and
       make it vanish with no way to get it back. */
    if (!Number.isFinite(x) || !Number.isFinite(y)) return fallback;
    return { x: clamp(x, 0, 1), y: clamp(y, 0, 1) };
  } catch {
    return fallback;
  }
}

/* --------------------------------------------------------------------------
 * Viewport size, as an external store.
 *
 * `useSyncExternalStore` rather than `useState` + an effect that measures: the
 * window *is* an external store, and reading it in an effect means committing a
 * render with the wrong size and then correcting it — the cascading render the
 * repo's lint rules reject, and the reason `useSafeReducedMotion` is written this
 * way too.
 *
 * One subscription for the whole app: every draggable control shares these
 * listeners and the cached snapshot, so N controls cost one resize handler.
 * ------------------------------------------------------------------------ */

type Viewport = { w: number; h: number };

/* `useSyncExternalStore` compares snapshots by identity, so this must return the
   same object until the size actually changes or React re-renders forever. */
let viewportCache: Viewport = { w: 0, h: 0 };
const viewportListeners = new Set<() => void>();

function readViewport() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  if (w !== viewportCache.w || h !== viewportCache.h) viewportCache = { w, h };
  return viewportCache;
}

function subscribeViewport(onChange: () => void) {
  if (typeof window === "undefined") return () => {};

  if (viewportListeners.size === 0) readViewport();
  viewportListeners.add(onChange);

  const handle = () => {
    readViewport();
    for (const listener of viewportListeners) listener();
  };

  window.addEventListener("resize", handle);
  window.addEventListener("orientationchange", handle);

  return () => {
    viewportListeners.delete(onChange);
    window.removeEventListener("resize", handle);
    window.removeEventListener("orientationchange", handle);
  };
}

function getViewportSnapshot(): Viewport {
  return viewportCache;
}

/* The server has no window. Zero means "not measured yet", which the hook reports
   as `ready: false` so the caller can render the fallback position without
   animating to it. */
const SERVER_VIEWPORT: Viewport = { w: 0, h: 0 };
function getServerViewport(): Viewport {
  return SERVER_VIEWPORT;
}

export function useDraggableFab({
  storageKey,
  fallback,
  size,
  insetTop,
  insetBottom,
  insetX,
}: Options) {
  /*
   * `null` until the first drag, and the stored value is read lazily.
   *
   * `useState` with an initialiser function runs it once, on the first render —
   * on the client that is after hydration for a component this deep, but to be
   * safe against a mismatch the initialiser returns `null` on the server and the
   * stored anchor only ever comes from `readAnchor` in the browser.
   */
  const [anchor, setAnchor] = useState<FabAnchor | null>(() =>
    typeof window === "undefined" ? null : readAnchor(storageKey, fallback)
  );

  const viewport = useSyncExternalStore(
    subscribeViewport,
    getViewportSnapshot,
    getServerViewport
  );

  const measured = viewport.w > 0 && viewport.h > 0;
  const active = anchor ?? fallback;

  /* The rectangle the button's top-left corner may occupy. */
  const bandX = measured ? Math.max(0, viewport.w - size - insetX * 2) : 0;
  const bandY = measured
    ? Math.max(0, viewport.h - size - insetTop - insetBottom)
    : 0;

  const left = insetX + bandX * active.x;
  const top = insetTop + bandY * active.y;

  const dragging = useRef(false);

  /* Read by the click handler to swallow the click that ends a drag. Without it,
     letting go of the button counts as a tap and the panel opens every time the
     user moves it. */
  const wasDragged = useRef(false);

  const onDragStart = useCallback(() => {
    dragging.current = true;
    wasDragged.current = false;
  }, []);

  const onDragMove = useCallback((distance: number) => {
    /* A few pixels of travel is a shaky tap, not a drag. Below the threshold the
       release still opens the panel, which is what someone with an unsteady thumb
       expects to happen. */
    if (distance > 6) wasDragged.current = true;
  }, []);

  const onDragEnd = useCallback(
    (offsetX: number, offsetY: number) => {
      dragging.current = false;
      if (!measured) return;

      const nextLeft = clamp(left + offsetX, insetX, insetX + bandX);
      const nextTop = clamp(top + offsetY, insetTop, insetTop + bandY);

      /* Horizontal snaps to the nearer edge; vertical is kept exactly. */
      const centreX = nextLeft + size / 2;
      const snappedX = centreX < viewport.w / 2 ? 0 : 1;
      const nextY = bandY > 0 ? clamp((nextTop - insetTop) / bandY, 0, 1) : 0;

      const next: FabAnchor = { x: snappedX, y: nextY };
      setAnchor(next);
      try {
        window.localStorage.setItem(storageKey, JSON.stringify(next));
      } catch {
        // Storage disabled — the position still holds for this session.
      }
    },
    [viewport, left, top, bandX, bandY, insetX, insetTop, size, storageKey]
  );

  const consumeClick = useCallback(() => {
    if (!wasDragged.current) return false;
    wasDragged.current = false;
    return true;
  }, []);

  return {
    /** Pixels from the left of the viewport. */
    left,
    /** Pixels from the top of the viewport. */
    top,
    /** True once the viewport has been measured — before that, avoid animating. */
    ready: viewport !== null,
    /** Which side it is parked on, for the panel to open away from it. */
    side: active.x < 0.5 ? ("left" as const) : ("right" as const),
    onDragStart,
    onDragMove,
    onDragEnd,
    /** Call in `onClick`; returns true when the click was really a drag release. */
    consumeClick,
  };
}

export default useDraggableFab;
