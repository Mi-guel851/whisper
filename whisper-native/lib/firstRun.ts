import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * The first-run flag.
 *
 * The app's front door (`app/index.tsx`) sends a signed-out user to login, and
 * the onboarding screen — the animated "Say it. Anonymously." intro — is the
 * thing a brand-new user should see once before they meet a password field.
 * One flag in AsyncStorage records "the intro has been seen", so the login
 * screen can route first-timers through it and never again.
 *
 * Failures read as "not seen": the worst case is the intro playing twice,
 * which is a far better failure than never.
 */
const KEY = "whisper:onboarded";

export async function markOnboarded(): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, "1");
  } catch {
    /* Storage denied — the flag is a convenience, never a gate. */
  }
}

export async function isOnboarded(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(KEY)) === "1";
  } catch {
    return false;
  }
}
