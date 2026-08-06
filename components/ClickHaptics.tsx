"use client";

import { useEffect } from "react";
import { vibrate } from "@/lib/haptics";

const INTERACTIVE = "button, a, [role='button'], input[type='submit'], summary";

/**
 * App-wide tap feedback.
 *
 * Listens on `pointerdown`, not `click`. The two fire at opposite ends of the
 * same gesture: `pointerdown` at the instant the finger lands, `click` only
 * after it lifts. A buzz on release is feedback for something the user already
 * finished doing, and it reads as lag even when nothing is actually slow —
 * the press is the moment that wants acknowledging, which is the same reason
 * the CSS `:active` scale is on press too. Now they land on the same frame.
 *
 * Capture phase so a component calling `stopPropagation` on its own handler
 * doesn't silently lose the haptic, and `passive` because this never calls
 * `preventDefault` — telling the browser that up front keeps the listener off
 * the critical path for scroll gestures that begin on a button.
 */
export default function ClickHaptics() {
  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      /* Primary contact only. A second finger landing during a pinch, or the
         right button of a mouse, isn't a press being acknowledged. */
      if (!event.isPrimary || (event.pointerType === "mouse" && event.button !== 0)) return;

      const target = event.target as HTMLElement | null;
      const interactive = target?.closest(INTERACTIVE) as HTMLElement | null;
      if (!interactive) return;

      // A disabled control isn't going to do anything — buzzing for it promises
      // an action that never arrives.
      if (interactive.matches(":disabled, [aria-disabled='true']")) return;

      vibrate(12);
    }

    document.addEventListener("pointerdown", handlePointerDown, { capture: true, passive: true });
    return () => document.removeEventListener("pointerdown", handlePointerDown, { capture: true });
  }, []);

  return null;
}
