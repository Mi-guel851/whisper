/**
 * Platform choice — the "Continue on site or download app" gate.
 *
 * FLOW (simple & unique)
 * ───────────────────────
 *  Landing ("Create My Link" / "Start Whispering")  →  /choose-platform (once)
 *        │  if already chosen or native → /signup directly
 *        ▼
 *  /choose-platform shows two paths:
 *    • Continue on Web  → stores choice, goes to /signup
 *    • Download Android App → opens Play Store, stores choice, next time skips gate
 *
 * Once a choice is stored, every future "Start Whispering" click bypasses the
 * gate and lands straight on the Google OAuth step (|signup| = "Continue with Google").
 * Native (Capacitor) never sees the gate at all.
 *
 * STORAGE
 *  `whisper:platform-choice` = "web" | "app"
 *  `whisper:platform-chosen-at` = epoch ms (for possible future expiry)
 *
 * The gate is purely client-side so it adds zero latency to auth and works
 * offline. No server flag is needed — the app *is* the proof.
 */

export const PLATFORM_CHOICE_KEY = "whisper:platform-choice";
export const PLATFORM_CHOSEN_AT_KEY = "whisper:platform-chosen-at";

export type PlatformChoice = "web" | "app";

export function getPlatformChoice(): PlatformChoice | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(PLATFORM_CHOICE_KEY);
  if (raw === "web" || raw === "app") return raw;
  return null;
}

export function hasChosenPlatform(): boolean {
  return getPlatformChoice() !== null;
}

export function setPlatformChoice(choice: PlatformChoice): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PLATFORM_CHOICE_KEY, choice);
    window.localStorage.setItem(PLATFORM_CHOSEN_AT_KEY, String(Date.now()));
  } catch {}
}

export function clearPlatformChoice(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(PLATFORM_CHOICE_KEY);
    window.localStorage.removeItem(PLATFORM_CHOSEN_AT_KEY);
  } catch {}
}

/**
 * Whether the interstitial should be shown.
 * Native shell never shows it (you're already in the app).
 * Web shows it exactly once — until a choice is stored.
 */
export function shouldShowPlatformChoice(isNative: boolean): boolean {
  if (isNative) return false;
  return !hasChosenPlatform();
}

/**
 * Where a "Start Whispering" CTA should go.
 * Keep the landing `href` honest: if we can decide synchronously we return
 * the final destination; the caller can still do a runtime check for the
 * Capacitor edge case.
 */
export function getStartWhisperingHref(isNative: boolean): string {
  if (shouldShowPlatformChoice(isNative)) return "/choose-platform";
  return "/signup";
}
