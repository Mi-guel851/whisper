"use client";

/**
 * Coordination between the two login-time popups.
 *
 * The follow-socials prompt and an admin announcement can both be eligible on
 * the same login. They must not stack — two modal dialogs at once is not an
 * announcement, it's an accident — and the social prompt deliberately goes
 * first (it is the standard "welcome back" beat). This module is a tiny
 * one-shot gate: the social prompt marks the intro "settled" the moment it has
 * either been shown-and-dismissed or decided not to appear, and the
 * announcement prompt waits for that before revealing itself.
 *
 * Module-level on purpose: the two components are siblings mounted in the root
 * layout with no shared parent state, and a full page load (the real
 * "app open" signal) resets the module, which is exactly the cadence we want.
 */

type Listener = () => void;

let settled = false;
const listeners = new Set<Listener>();
/** Hard fallback so a social prompt that never reports still releases the gate. */
let fallbackTimer: ReturnType<typeof setTimeout> | null = null;

function armFallback() {
  if (fallbackTimer) return;
  fallbackTimer = setTimeout(() => {
    fallbackTimer = null;
    settle();
  }, 15_000);
}

/** Called by the social prompt when the intro beat is over. */
export function notifyIntroSettled() {
  settle();
}

/** Subscribe to the settle event; resolves immediately if it already fired. */
export function whenIntroSettled(cb: Listener): () => void {
  if (settled) {
    cb();
    return () => {};
  }
  armFallback();
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function settle() {
  if (settled) return;
  settled = true;
  if (fallbackTimer) {
    clearTimeout(fallbackTimer);
    fallbackTimer = null;
  }
  listeners.forEach((l) => {
    try {
      l();
    } catch {
      /* one bad listener must not block the rest */
    }
  });
  listeners.clear();
}
