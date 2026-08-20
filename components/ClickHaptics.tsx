"use client";

import { useEffect } from "react";
import { HAPTIC, vibrate } from "@/lib/haptics";

/* `label:has(input[type='file'])` is here because a label wrapping a hidden file
   input is a button in every way that matters to the person tapping it — that
   pattern is how attachments are picked across the app. `[data-haptic]` is the
   escape hatch for anything pressable that matches none of these, without a
   second listener.

   The last four cover the app's own pressables that are not semantic buttons:
   tab strips, list rows, and the switch/tab roles. Without them a "tap anything"
   promise is only kept for about half the surface, which reads as broken rather
   than as partial.

   `:has()` is split out because `closest()` throws a SyntaxError on a selector
   it cannot parse, and one unsupported clause would take the whole handler down
   rather than degrade. Tested once at module load, not per press. */
const BASE_INTERACTIVE =
  "button, a, [role='button'], [role='tab'], [role='switch'], [role='menuitem'], input[type='submit'], input[type='button'], input[type='checkbox'], input[type='radio'], select, summary, [data-haptic]";

const LABEL_INTERACTIVE = "label:has(input[type='file'])";

const INTERACTIVE = (() => {
  if (typeof document === "undefined") return BASE_INTERACTIVE;
  try {
    document.createDocumentFragment().querySelector(LABEL_INTERACTIVE);
    return `${BASE_INTERACTIVE}, ${LABEL_INTERACTIVE}`;
  } catch {
    return BASE_INTERACTIVE;
  }
})();

/**
 * How far the finger may drift off a control and still count as a press. Matches
 * the ~10px hysteresis native platforms allow, so a slightly sloppy tap still
 * gets acknowledged while a deliberate drag-away-to-cancel stays silent.
 */
const RELEASE_SLOP_PX = 12;

/**
 * App-wide tap feedback.
 *
 * WHY THE FIRST VERSION OF THIS BUZZED ON NATIVE BUT NEVER ON THE WEBSITE
 *
 * `navigator.vibrate()` is gated on user activation, and the HTML spec's list of
 * activation-triggering events is narrower than it looks:
 *
 *     pointerdown  — only when pointerType is "mouse"
 *     pointerup    — only when pointerType is NOT "mouse"
 *     touchend, mousedown, keydown
 *
 * So on a phone, `pointerdown` grants no activation at all: the browser refuses
 * the call and returns false. A desktop mouse press does grant it, which is
 * exactly why this looked fine on a laptop and dead on Android. For touch, the
 * release is the earliest moment the platform will allow a buzz — there is no
 * way around that, only a way to notice it.
 *
 * Hence: ask on `pointerdown`, and if the browser refuses, retry on the matching
 * `pointerup`. Presses that the platform lets us acknowledge immediately still
 * are — native shell, mouse, and any browser using sticky rather than transient
 * activation — and the rest fall back to the release instead of being lost.
 * `vibrate()` returning a boolean is what makes this possible.
 *
 * Listening on `pointerdown` first still matters: it is the instant the finger
 * lands, which is the moment that wants acknowledging and the same frame the CSS
 * `:active` scale runs on. A buzz that only ever arrived on release would read as
 * lag even when nothing was slow.
 *
 * Capture phase so a component calling `stopPropagation` on its own handler
 * doesn't silently lose the haptic, and `passive` because this never calls
 * `preventDefault` — telling the browser that up front keeps the listener off
 * the critical path for scroll gestures that begin on a button.
 */
export default function ClickHaptics() {
  useEffect(() => {
    /* A press the browser would not let us acknowledge yet, waiting for the
       release that finally carries activation. */
    let pendingPointerId: number | null = null;
    let pendingTarget: HTMLElement | null = null;

    /* A press that both `pointerdown` and `pointerup` refused, waiting on the
       `click` that follows. */
    let awaitingClick: HTMLElement | null = null;

    function clearPending() {
      pendingPointerId = null;
      pendingTarget = null;
    }

    function pressableFrom(target: EventTarget | null): HTMLElement | null {
      const element = target as HTMLElement | null;
      // `closest` is optional-called because the target can be `document`.
      const interactive = element?.closest?.(INTERACTIVE) as HTMLElement | null;
      if (!interactive) return null;
      // A disabled control isn't going to do anything — buzzing for it promises
      // an action that never arrives.
      if (interactive.matches(":disabled, [aria-disabled='true']")) return null;
      return interactive;
    }

    function handlePointerDown(event: PointerEvent) {
      clearPending();
      awaitingClick = null;

      /* Primary contact only. A second finger landing during a pinch, or the
         right button of a mouse, isn't a press being acknowledged. */
      if (!event.isPrimary || (event.pointerType === "mouse" && event.button !== 0)) return;

      const interactive = pressableFrom(event.target);
      if (!interactive) return;

      if (vibrate(HAPTIC.tap)) return;

      pendingPointerId = event.pointerId;
      pendingTarget = interactive;
    }

    function handlePointerUp(event: PointerEvent) {
      const target = pendingTarget;
      if (pendingPointerId !== event.pointerId || !target) return;
      clearPending();

      /* Touch pointers are implicitly captured by the element the gesture began
         on, so `event.target` still names the button even after the finger has
         slid well away from it. Check the geometry instead — a release outside
         the control is a cancelled press, and cancelled presses stay silent. */
      const box = target.getBoundingClientRect();
      const released =
        event.clientX >= box.left - RELEASE_SLOP_PX &&
        event.clientX <= box.right + RELEASE_SLOP_PX &&
        event.clientY >= box.top - RELEASE_SLOP_PX &&
        event.clientY <= box.bottom + RELEASE_SLOP_PX;

      if (released) {
        if (vibrate(HAPTIC.tap)) return;
        /* Even the release was refused. `click` is the last event in the sequence
           and the one platforms are most permissive about, so hand it over rather
           than give up — see `handleClick`. */
        awaitingClick = target;
      }
    }

    /**
     * Last resort.
     *
     * `click` carries user activation on every platform and in every browser —
     * it is the canonical activation-triggering event, more reliable than either
     * pointer event. It is not used as the *primary* trigger because it fires
     * after the browser has resolved the gesture, which on touch is 50-100ms
     * behind the finger landing and reads as lag. But a buzz slightly late beats
     * no buzz at all, and this is the branch that finally covers browsers whose
     * activation rules are stricter than the spec's list suggests.
     */
    function handleClick(event: MouseEvent) {
      const target = awaitingClick;
      awaitingClick = null;
      if (!target) return;
      // Only if this click belongs to the press we gave up on.
      if (!target.contains(event.target as Node) && event.target !== target) return;
      vibrate(HAPTIC.tap);
    }

    /* The gesture turned into a scroll or was taken over by the system. Drop the
       pending buzz — this also removes a false positive the old version had,
       where a swipe that happened to start on a button felt like a press. */
    function handlePointerCancel(event: PointerEvent) {
      if (pendingPointerId === event.pointerId) clearPending();
      awaitingClick = null;
    }

    const listen = { capture: true, passive: true } as const;
    document.addEventListener("pointerdown", handlePointerDown, listen);
    document.addEventListener("pointerup", handlePointerUp, listen);
    document.addEventListener("pointercancel", handlePointerCancel, listen);
    document.addEventListener("click", handleClick, listen);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, { capture: true });
      document.removeEventListener("pointerup", handlePointerUp, { capture: true });
      document.removeEventListener("pointercancel", handlePointerCancel, { capture: true });
      document.removeEventListener("click", handleClick, { capture: true });
    };
  }, []);

  return null;
}
