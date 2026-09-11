/**
 * App distribution config.
 *
 * PLACE YOUR PLAY STORE LINK HERE once you have a developer account.
 * The helper keeps the whole "download app" flow working before that —
 * it falls back to "#" and the UI disables the button gracefully.
 *
 * Why a module and not an env var alone: the choose-platform page, the
 * landing banner, and the dashboard all need the same URL, and they need
 * it on the client (Capacitor, localStorage checks). Importing one constant
 * is cheaper than reading `process.env` in three client components and
 * remembering the fallback in each of them.
 */

export const PLAY_STORE_URL: string =
  (process.env.NEXT_PUBLIC_PLAY_STORE_URL as string | undefined)?.trim() ||
  // TODO: replace with your real Play Store URL once the app is published
  // example: "https://play.google.com/store/apps/details?id=com.whisper.app"
  "#";

export const PLAY_STORE_READY: boolean = PLAY_STORE_URL !== "#" && PLAY_STORE_URL.startsWith("http");

/** Shown wherever the store link appears — same everywhere, single source. */
export const PLAY_STORE_LABEL = "Get it on Google Play";
