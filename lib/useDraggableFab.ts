"use client";

import { useCallback, useEffect, useRef, useState } from "react";

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

export function useDraggableFab({
  storageKey,
  fallback,
  size,
  insetTop,
  insetBottom,
  insetX,
}: Options) {
  /*
   * `null` until mounted, and the caller renders the fallback position until then.
   * Reading localStorage during the first render would put a remembered position
   * in the client's HTML that the server could not have produced — the hydration
   * mismatch `useSafeReducedMotion` exists to avoid, for the same reason.
   */
  const [anchor, setAnchor] = useState<FabAnchor | null>(null);
  const [viewport, setViewport] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    setAnchor(readAnchor(storageKey, fallback));
    // `fallback` is a literal at the call site; re-reading on identity churn would
    // clobber a position the user just set.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  /* Rotation and desktop resizes both change what "against the right edge" means,
     so the derived pixels are recomputed rather than cached. */
  useEffect(() => {
    const measure = () =>
      setViewport({ w: window.innerWidth, h: window.innerHeight });
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("orientationchange", measure);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("orientationchange", measure);
    };
  }, []);

  const active = anchor ?? fallback;

  /* The rectangle the button's top-left corner may occupy. */
  const bandX = viewport ? Math.max(0, viewport.w - size - insetX * 2) : 0;
  const bandY = viewport
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
      if (!viewport) return;

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
