import { Capacitor } from "@capacitor/core";

/**
 * Haptic feedback, on the native shell and on the web.
 *
 * WHY THE WEB PATH WAS SILENT ON ANDROID
 *
 * Every call site asked for ~10-18ms, which is right for `ImpactStyle.Light`
 * on a phone whose OS renders the waveform, and wrong for `navigator.vibrate`,
 * which hands the number straight to the vibrator driver. An LRA needs a few
 * milliseconds just to spin up and the same again to stop, so a 12ms request
 * produces a pulse most people cannot feel and many devices drop outright.
 * Anything under ~20ms is below the floor in practice.
 *
 * So durations are treated as *intent* rather than as literal timings: the
 * native path maps them onto Capacitor's impact styles, and the web path
 * rescales them onto what a vibrator motor can actually render.
 *
 * Two more things this fixes:
 *
 * - `navigator.vibrate()` returns false when the browser refuses (no motor,
 *   hidden document, no sticky activation, DND on some builds). That return was
 *   discarded, so a refusal looked exactly like success. It is returned now, and
 *   `ClickHaptics` uses it to retry at a moment the browser will accept — see
 *   the activation note in that file, which is the other half of this fix.
 * - The web branch stays synchronous. `navigator.vibrate` needs user
 *   activation, and activation does not survive an `await` — so nothing may be
 *   awaited before it on a path that can reach it. The native import is behind
 *   `isNativePlatform()`, which is synchronous, and the web branch runs in the
 *   same task as the `pointerdown` that triggered it.
 */

/**
 * Below this an Android vibrator has not finished spinning up. Measured on a
 * mid-range LRA: 22ms is technically a pulse and practically nothing, which is
 * why the first attempt at this file still felt dead. 30ms is the point where a
 * tap reads as deliberate feedback rather than as a glitch.
 */
const WEB_FLOOR_MS = 30;

/** Above this a "tap" stops reading as feedback and starts reading as a buzz. */
const WEB_CEILING_MS = 60;

/**
 * Native durations are written for an OS that renders a tuned waveform. A raw
 * motor needs roughly this much more time to produce the same sensation.
 */
const WEB_SCALE = 2.6;

/** Anything at or under this asks for a light tick rather than a real buzz. */
const LIGHT_IMPACT_MAX_MS = 15;

/**
 * Named intents, so call sites stop encoding driver timings. Raw numbers are
 * still accepted — they are what the rescaling above operates on — but new code
 * should reach for these.
 */
export const HAPTIC = {
  /** Every button press. The most frequent, so the shortest. */
  tap: 12,
  /** A state committed: recording started, item selected. */
  select: 18,
  /** Two-pulse confirmation: locked, saved, sent. */
  success: [10, 30, 10],
  /** Rejected or destroyed: cancelled recording, failed send. */
  warning: [14, 40, 14],
} as const;

/**
 * Resolved once. `isNativePlatform()` reads a global the Capacitor runtime sets
 * at startup and cannot change afterwards, and this is called on every press.
 */
let nativePlatform: boolean | null = null;

function isNative(): boolean {
  if (nativePlatform === null) nativePlatform = Capacitor.isNativePlatform();
  return nativePlatform;
}

type HapticsModule = {
  impact: (options: { style: unknown }) => Promise<void>;
  vibrate: (options: { duration: number }) => Promise<void>;
};

type ImpactStyleEnum = { Light: unknown; Medium: unknown; Heavy: unknown };

/**
 * The plugin import is cached across presses. Left un-cached it was a dynamic
 * `import()` per tap — resolved from the module map rather than the network, but
 * still a microtask chain and a promise allocation on the input path, which is
 * exactly where latency is most visible.
 */
let nativeModule: Promise<{ Haptics: HapticsModule; ImpactStyle: ImpactStyleEnum } | null> | null =
  null;

function loadNative() {
  if (!nativeModule) {
    nativeModule = import("@capacitor/haptics")
      .then((mod) => mod as unknown as { Haptics: HapticsModule; ImpactStyle: ImpactStyleEnum })
      .catch(() => null);
  }
  return nativeModule;
}

/**
 * A haptic request: one duration, or a buzz/gap/buzz… pattern.
 *
 * `readonly` because `HAPTIC` below is `as const`, which gives its patterns
 * readonly tuple types — a plain `number[]` parameter would reject every one of
 * them. Nothing here mutates the input, so widening costs nothing.
 */
export type HapticPattern = number | readonly number[];

/** Total buzz time a pattern asks for, ignoring its gaps. */
function intensityOf(pattern: HapticPattern): number {
  if (typeof pattern === "number") return pattern;
  // Even indices are buzzes, odd ones are silence.
  return pattern.reduce((total, value, index) => (index % 2 === 0 ? total + value : total), 0);
}

/**
 * Rescale an intent onto what a vibrator can render. A single value is clamped
 * into the perceptible band; a pattern keeps its rhythm — the gaps are what
 * make a double-tap read as two events — and only its buzzes are lengthened.
 */
function toWebPattern(pattern: HapticPattern): number | number[] {
  if (typeof pattern === "number") {
    return Math.min(WEB_CEILING_MS, Math.max(WEB_FLOOR_MS, Math.round(pattern * WEB_SCALE)));
  }
  /* `.map` on a readonly array returns a fresh mutable one, which is what the
     Vibration API's signature wants. */
  return pattern.map((value, index) =>
    index % 2 === 0
      ? Math.min(WEB_CEILING_MS, Math.max(WEB_FLOOR_MS, Math.round(value * WEB_SCALE)))
      : value
  );
}

/**
 * Fire a haptic. Returns whether the platform accepted it — false means no
 * motor, no permission, or a browser that refused, all of which are normal and
 * none of which are errors worth surfacing to the user.
 *
 * Callers may ignore the result; it exists so a caller that cares can tell
 * "there is no vibrator" from "it fired".
 */
export function vibrate(pattern: HapticPattern = HAPTIC.tap): boolean {
  if (typeof window === "undefined") return false;

  if (isNative()) {
    /* Fire-and-forget on purpose. The native bridge is asynchronous and the
       caller is on the input path — awaiting it would put the plugin round trip
       between the press and the frame that responds to it. */
    void loadNative().then(async (mod) => {
      if (!mod) return;
      const { Haptics, ImpactStyle } = mod;
      try {
        const intensity = intensityOf(pattern);
        if (intensity <= LIGHT_IMPACT_MAX_MS) {
          await Haptics.impact({ style: ImpactStyle.Light });
        } else if (typeof pattern === "number") {
          await Haptics.vibrate({ duration: pattern });
        } else {
          /* CoreHaptics and Android's VibrationEffect both express a multi-pulse
             cue better as repeated impacts than as one long buzz, and this keeps
             the rhythm the pattern was written for. */
          for (let index = 0; index < pattern.length; index += 2) {
            await Haptics.impact({ style: ImpactStyle.Medium });
            const gap = pattern[index + 1];
            if (gap) await new Promise((resolve) => setTimeout(resolve, gap));
          }
        }
      } catch {
        /* A device with haptics disabled throws here. Nothing to recover. */
      }
    });
    return true;
  }

  /* Web. Synchronous from here down — see the note at the top of the file. */
  const navigatorWithVibrate = navigator as Navigator & {
    vibrate?: (pattern: number | number[]) => boolean;
  };
  if (typeof navigatorWithVibrate.vibrate !== "function") return false;

  /* Chrome cancels a vibration when the document is hidden and rejects one
     started while hidden, so skip rather than fire into nothing. */
  if (typeof document !== "undefined" && document.visibilityState === "hidden") return false;

  try {
    return navigatorWithVibrate.vibrate(toWebPattern(pattern)) !== false;
  } catch {
    return false;
  }
}

export default vibrate;
