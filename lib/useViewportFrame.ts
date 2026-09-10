"use client";

import { useEffect } from "react";
import useEventCallback from "./useEventCallback";

/**
 * Pins a screen to the *visual* viewport, the way a native chat app does.
 *
 * Two separate things go wrong on a full-height screen and both of them show up
 * in the chat page.
 *
 * The first is the keyboard. `100vh` is the **large** viewport and `100dvh` only
 * shrinks for browser chrome, so neither of them moves when a software keyboard
 * opens: Android Chrome's default `interactive-widget=resizes-visual` shrinks the
 * visual viewport and leaves the layout viewport alone, which leaves a composer
 * pinned to the bottom of a `h-screen` shell sitting *behind* the keyboard. You
 * cannot see what you are typing until you dismiss it. The viewport meta has a
 * `resizes-content` mode that fixes Android, but it applies to every route in the
 * app and would lift every fixed bottom bar above the keyboard; iOS ignores it
 * anyway. `visualViewport` shrinks under both defaults and can be scoped to the
 * screens that ask for it, so that is what this measures.
 *
 * The second is the document itself. `body` carries the safe-area insets *and* a
 * `100dvh` minimum, so a child that is also a full viewport tall makes the
 * document taller than the viewport by the inset total — twenty to thirty-odd
 * pixels of slack that the whole page can be dragged through. That is the
 * "wobble": not the message list scrolling, the entire document sliding under it.
 *
 * So this hook does exactly two things. It publishes the height a frame can
 * actually occupy as `--app-frame-height` — the visual viewport minus whatever
 * `body`'s padding is currently taking, read live from the computed style so it
 * stays correct when the insets themselves change (they collapse while the
 * keyboard is up) — and it locks the document against scrolling for as long as
 * any frame is mounted. Pair it with the `.viewport-frame` class.
 *
 * `onResize` fires after each measurement, which is how the chat page keeps the
 * newest message pinned as the keyboard arrives.
 */

const FRAME_HEIGHT_VAR = "--app-frame-height";
const LOCK_CLASS = "viewport-locked";

/* Route transitions can briefly mount the next screen while the previous one is
   still leaving, so the lock is reference-counted. Releasing on the first unmount
   would drop it while a frame is still on screen. */
let lockCount = 0;

function measure(): number {
  const viewport = window.visualViewport;
  /* The layout viewport is the ceiling. On some Android builds the visual
     viewport outlives a URL-bar/keyboard transition and reports a stale
     tall value; sizing the frame from it alone would run the frame past the
     visible screen and push the composer below the fold. `innerHeight` is
     never taller than what is actually on screen, so capping at it keeps
     the composer reachable in every state (it equals the visual height in
     the normal case, so healthy devices see no change). */
  const visual = viewport ? viewport.height : window.innerHeight;
  const available = Math.min(visual, window.innerHeight);
  /* The insets resolve to pixels here, so there is no need to guess at whether
     `env(safe-area-inset-bottom)` is still 34px with a keyboard over it. */
  const bodyStyle = getComputedStyle(document.body);
  const taken =
    (parseFloat(bodyStyle.paddingTop) || 0) + (parseFloat(bodyStyle.paddingBottom) || 0);
  /* Rounding keeps the frame off half-pixel boundaries, which is what makes a
     sticky header shimmer as the list scrolls under it. */
  return Math.max(0, Math.round(available - taken));
}

export default function useViewportFrame(onResize?: () => void) {
  /* Held by the house latest-ref helper so callers can pass an inline closure
     without the listeners being torn down and re-attached on every render. */
  const notify = useEventCallback(() => {
    onResize?.();
  });

  useEffect(() => {
    const root = document.documentElement;

    function sync() {
      root.style.setProperty(FRAME_HEIGHT_VAR, `${measure()}px`);
      notify();
    }

    lockCount += 1;
    root.classList.add(LOCK_CLASS);
    sync();

    const viewport = window.visualViewport;
    /* `scroll` matters as much as `resize`: iOS shifts the visual viewport up to
       reveal a focused field rather than resizing anything, and that shift is
       reported here. */
    viewport?.addEventListener("resize", sync);
    viewport?.addEventListener("scroll", sync);
    /* Fallback for the no-`visualViewport` case, and the only signal for a
       rotation that happens to leave the height unchanged. */
    window.addEventListener("orientationchange", sync);
    window.addEventListener("resize", sync);
    /* Back/forward-cache restores can hand back a frame measured for a different
       viewport state without firing resize — re-sync on reveal. */
    window.addEventListener("pageshow", sync);

    return () => {
      viewport?.removeEventListener("resize", sync);
      viewport?.removeEventListener("scroll", sync);
      window.removeEventListener("orientationchange", sync);
      window.removeEventListener("resize", sync);
      window.removeEventListener("pageshow", sync);
      lockCount = Math.max(0, lockCount - 1);
      if (lockCount === 0) {
        root.classList.remove(LOCK_CLASS);
        root.style.removeProperty(FRAME_HEIGHT_VAR);
      }
    };
    /* `notify` has a fixed identity, so this runs once per mounted frame. */
  }, [notify]);
}

export { FRAME_HEIGHT_VAR, LOCK_CLASS };
