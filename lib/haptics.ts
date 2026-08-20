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

/* --------------------------------------------------------------------------
 * The user's own switch
 * ------------------------------------------------------------------------ */

/** Mirrors the theme preference's storage convention. */
const ENABLED_KEY = "whisper-haptics";

/**
 * Read once and cached, because `vibrate()` runs on every press and
 * `localStorage.getItem` is a synchronous main-thread call that can hit disk.
 * `setHapticsEnabled` keeps the cache in step, so nothing re-reads storage.
 */
let enabledCache: boolean | null = null;

export function isHapticsEnabled(): boolean {
  if (enabledCache !== null) return enabledCache;
  if (typeof window === "undefined") return true;
  try {
    /* Absent means on. Haptics are the default experience; the switch exists to
       turn them *off*, so a fresh install must not start silent. */
    enabledCache = window.localStorage.getItem(ENABLED_KEY) !== "off";
  } catch {
    enabledCache = true;
  }
  return enabledCache;
}

export function setHapticsEnabled(enabled: boolean): void {
  enabledCache = enabled;
  try {
    window.localStorage.setItem(ENABLED_KEY, enabled ? "on" : "off");
  } catch {
    /* Private mode with storage denied. The in-memory cache still holds for this
       session, which is the best that can be offered. */
  }
}


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

/**
 * Whether the Haptics plugin is actually registered in the native project.
 *
 * WHY THIS EXISTS: the previous version returned `true` from the native branch
 * unconditionally, *before* the bridge call had been attempted — and the call
 * itself was fire-and-forget with a `catch {}`. So on a shell built before
 * `@capacitor/haptics` was synced into the Android project, every impact threw
 * into that empty catch, `vibrate()` still reported success, and the web
 * vibrator was never tried. Silent, and indistinguishable from working.
 *
 * `isPluginAvailable` is synchronous, which is the important part: it lets an
 * unregistered plugin fall through to `navigator.vibrate` *in the same task as
 * the gesture*, so user activation is still intact. Deciding this from the
 * async failure instead would arrive too late to vibrate at all.
 */
let hapticsPluginAvailable: boolean | null = null;

function nativeHapticsAvailable(): boolean {
  if (hapticsPluginAvailable === null) {
    try {
      hapticsPluginAvailable = Capacitor.isPluginAvailable("Haptics");
    } catch {
      hapticsPluginAvailable = false;
    }
    if (!hapticsPluginAvailable) {
      console.warn(
        "[haptics] the Capacitor Haptics plugin is not registered in this build — falling back to navigator.vibrate. Run `npx cap sync android` and rebuild the APK to get native haptics back."
      );
    }
  }
  return hapticsPluginAvailable;
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
 * The web vibrator. Synchronous from top to bottom — `navigator.vibrate` needs
 * user activation and activation does not survive an `await`, so nothing may be
 * awaited on any path that reaches this.
 */
function webVibrate(pattern: HapticPattern): boolean {
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

/**
 * Fire a haptic. Returns whether the platform accepted it — false means no
 * motor, no permission, or a browser that refused, all of which are normal and
 * none of which are errors worth surfacing to the user.
 *
 * A `true` here means *accepted*, not *felt*. If the OS-level touch-feedback
 * setting is off, Android accepts the request and renders nothing, and no amount
 * of code can tell the difference or override it.
 *
 * Callers may ignore the result; it exists so a caller that cares can tell
 * "there is no vibrator" from "it fired".
 */
export function vibrate(pattern: HapticPattern = HAPTIC.tap): boolean {
  if (typeof window === "undefined") return false;
  if (!isHapticsEnabled()) return false;

  if (isNative() && nativeHapticsAvailable()) {
    /* Fire-and-forget on purpose. The native bridge is asynchronous and the
       caller is on the input path — awaiting it would put the plugin round trip
       between the press and the frame that responds to it. */
    void loadNative().then(async (mod) => {
      if (!mod) {
        hapticsPluginAvailable = false;
        return;
      }
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
        /* A device with haptics disabled throws here, and so does a shell whose
           plugin is present in JS but unregistered natively. Latch it off so the
           *next* press takes the web path synchronously, while activation is
           still live — this press is already lost either way. */
        hapticsPluginAvailable = false;
      }
    });
    return true;
  }

  return webVibrate(pattern);
}

export default vibrate;

/* --------------------------------------------------------------------------
 * Diagnosis
 * ------------------------------------------------------------------------ */

/**
 * Why this exists.
 *
 * A haptic that does not fire is the hardest class of bug to chase, because
 * every possible cause produces the identical symptom: nothing. No motor, a
 * WebView without the plugin, a browser withholding user activation, an OS
 * touch-feedback switch turned off — all of them are "I tapped and felt
 * nothing", and none of them can be told apart by tapping harder.
 *
 * So rather than guess again, this reports which branch a press actually takes
 * and what the platform said when asked. It is the difference between "haptics
 * are broken" and "the plugin is missing from this build", which are two
 * different jobs with two different fixes.
 *
 * The one thing no code can determine: whether the phone physically buzzed.
 * Android accepts the request and renders nothing when the system-level touch
 * feedback setting is off, and reports success either way. That is why the
 * report ends in a question to the user rather than a verdict.
 */
export type HapticsDiagnosis = {
  /** Which implementation a press would reach. */
  path: "native-plugin" | "web-vibrator" | "none";
  /** True when the switch in Settings is on. */
  enabled: boolean;
  /** Running inside the Capacitor shell rather than a browser tab. */
  native: boolean;
  /** Native only: whether `@capacitor/haptics` is registered in this build. */
  pluginRegistered: boolean;
  /** Whether the browser exposes the Vibration API at all. iOS Safari does not. */
  webVibratorPresent: boolean;
  /** What the platform returned for a test buzz, if one was fired. */
  testAccepted: boolean | null;
  /** Plain-language summary, safe to show a user. */
  summary: string;
  /** The thing to try next, or null when the platform is doing its part. */
  advice: string | null;
};

/**
 * Runs a real test buzz and reports what happened.
 *
 * MUST be called synchronously from a click handler — it fires an actual
 * vibration, and `navigator.vibrate` needs user activation that does not survive
 * an `await`. Calling it from an effect will report a refusal that says nothing
 * about the device.
 */
export function diagnoseHaptics(): HapticsDiagnosis {
  const enabled = isHapticsEnabled();
  const native = typeof window !== "undefined" && isNative();
  const pluginRegistered = native ? nativeHapticsAvailable() : false;
  const webVibratorPresent =
    typeof navigator !== "undefined" &&
    typeof (navigator as Navigator & { vibrate?: unknown }).vibrate === "function";

  const path: HapticsDiagnosis["path"] =
    native && pluginRegistered
      ? "native-plugin"
      : webVibratorPresent
        ? "web-vibrator"
        : "none";

  /* Deliberately stronger than a tap: the point is to be unmistakable, so a
     "did you feel it?" answer means something. */
  const testAccepted = enabled && path !== "none" ? vibrate(HAPTIC.warning) : null;

  if (!enabled) {
    return {
      path,
      enabled,
      native,
      pluginRegistered,
      webVibratorPresent,
      testAccepted,
      summary: "Haptics are switched off.",
      advice: "Turn the switch above on and test again.",
    };
  }

  if (path === "none") {
    return {
      path,
      enabled,
      native,
      pluginRegistered,
      webVibratorPresent,
      testAccepted,
      summary: native
        ? "This build has no haptics plugin, and the WebView exposes no vibrator."
        : "This browser has no Vibration API — iOS Safari and most desktop browsers don't.",
      advice: native
        ? "Rebuild the app after `npx cap sync android`."
        : "Install Whisper from the Android app for haptics, or open the site in Chrome on Android.",
    };
  }

  if (testAccepted === false) {
    return {
      path,
      enabled,
      native,
      pluginRegistered,
      webVibratorPresent,
      testAccepted,
      summary: "The browser refused the vibration.",
      /* Almost always the sticky-activation rule or a hidden tab. Both resolve on
         a second press, which is why this asks for one rather than declaring a
         fault. */
      advice: "Tap Test once more — browsers ignore the first buzz on a fresh page.",
    };
  }

  return {
    path,
    enabled,
    native,
    pluginRegistered,
    webVibratorPresent,
    testAccepted,
    summary:
      path === "native-plugin"
        ? "Sent through the native haptics engine."
        : "Sent to the phone's vibration motor.",
    /* The honest ending. Everything under our control worked; if nothing was felt
       the remaining switch is one only the user can reach. */
    advice:
      "Felt nothing? Whisper's side worked, so check Android Settings → Sound & vibration → Vibration & haptics and make sure touch feedback is on.",
  };
}

