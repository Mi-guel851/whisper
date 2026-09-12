import * as Haptics from "expo-haptics";
import { Platform } from "react-native";

/**
 * Tactile feedback.
 *
 * The same four intents the web app exposes (`HAPTIC.tap` / `select` /
 * `success` / `warning`), so a screen ported from the site keeps its feedback
 * without re-deciding what a press should feel like. On Android the pattern is
 * expressed through `Haptics.performAndroidHapticsAsync`, which is the only
 * expo-haptics API that can produce more than a single tick; on iOS the same
 * intent maps to the Taptic Engine's impact/notification styles.
 */

export const HAPTIC = {
  /** Every button press — the most frequent, so the shortest. */
  tap: 20,
  /** A state committed: recording started, item selected. */
  select: 28,
  /** Two-pulse confirmation: locked, saved, sent. */
  success: [18, 34, 18],
  /** Rejected or destroyed: cancelled recording, failed send. */
  warning: [26, 44, 26],
} as const;

/** A user setting can turn these off; see `lib/settings.ts`. */
let enabled = true;

export function setHapticsEnabled(value: boolean) {
  enabled = value;
}

export function hapticsEnabled() {
  return enabled;
}

type Intent = keyof typeof HAPTIC;

export function vibrate(intent: Intent = "tap") {
  if (!enabled) return;

  try {
    switch (intent) {
      case "success":
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        break;
      case "warning":
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        break;
      case "select":
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        break;
      default:
        /* Android's CLOCK_TICK is deliberately the lightest available effect:
           the equivalent of `HAPTIC.tap`'s 20ms, which is meant to be felt and
           not noticed. iOS gets the light impact. */
        if (Platform.OS === "android") {
          void Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Clock_Tick);
        } else {
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        }
        break;
    }
  } catch {
    /* A device without a vibrator, or a simulator. Feedback is a nicety — it
       must never be the thing that breaks a press. */
  }
}
