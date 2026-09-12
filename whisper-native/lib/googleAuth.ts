import { GoogleSignin } from "@react-native-google-signin/google-signin";
import { Platform } from "react-native";

import { supabase } from "@/lib/supabase";

/**
 * Google sign-in — the native SDK path, replacing the Capacitor plugin the
 * shell used for the same job.
 *
 * The flow is the web app's native branch of `signInWithGoogle`
 * (`app/login/page.tsx`), step for step:
 *
 *   1. the native account picker (`GoogleSignin.signIn()` — the same popup
 *      `@codetrix-studio/capacitor-google-auth` produced; never a WebView);
 *   2. its `idToken`;
 *   3. `supabase.auth.signInWithIdToken({ provider: "google", token })`,
 *      which signs an existing account in *and* creates a new one — nothing
 *      in the API asks for only the first, which is why the signup gate has
 *      to exist at all.
 *
 * The client id is the web app's (`226343458064-…`, the same string the web
 * hardcodes in its Google handlers and `capacitor.config.ts` declares for
 * GoogleAuth). Override with `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` if the
 * project's OAuth client ever rotates.
 */

/** The web app's Google OAuth web client id. */
const WEB_CLIENT_ID_FALLBACK = "226343458064-tq6nf31ekoos2h6r7dk4dc1o1cobaoh5.apps.googleusercontent.com";

const webClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID || WEB_CLIENT_ID_FALLBACK;

let configured = false;

function ensureConfigured() {
  if (configured) return;
  GoogleSignin.configure({
    webClientId,
    scopes: ["profile", "email"],
    /* The idToken is all Supabase needs; offline access would mint a refresh
       token nobody in this app consumes. */
    offlineAccess: false,
  });
  configured = true;
}

export type GoogleSignInResult =
  | { cancelled: true }
  | { cancelled: false; error: string }
  | { cancelled: false; userId: string };

/** Whether new-account creation is open — the web app's `lib/signupGate.ts`. */
export const SIGNUPS_OPEN = process.env.EXPO_PUBLIC_SIGNUPS_OPEN === "true";
/** Closed is the interesting state, so most call sites read better as this. */
export const SIGNUPS_CLOSED = !SIGNUPS_OPEN;

/**
 * Run the native picker and exchange the result for a Supabase session.
 *
 * Resolves with `{ cancelled: true }` when the user backs out of the picker —
 * a choice, not an error, so callers stay quiet (the web handler skips its
 * toast on the same condition). Any other failure surfaces as a message.
 */
export async function signInWithGoogle(): Promise<GoogleSignInResult> {
  ensureConfigured();

  try {
    if (Platform.OS === "android") {
      /* Throws if Play Services are missing/outdated unless we allow the
         recovery dialog — the same prompt the Capacitor plugin showed. */
      await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    }

    const response = await GoogleSignin.signIn();

    if (response.type === "cancelled") {
      return { cancelled: true };
    }

    const idToken = response.data.idToken;
    if (!idToken) {
      return { cancelled: false, error: "Google sign-in failed. No token received." };
    }

    const { data, error } = await supabase.auth.signInWithIdToken({
      provider: "google",
      token: idToken,
    });

    if (error) {
      return { cancelled: false, error: error.message };
    }

    return { cancelled: false, userId: data.user?.id ?? "" };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Google sign-in failed.";
    /* A dismissed picker reports as a cancelled code on some SDK versions. */
    if (message.toLowerCase().includes("cancel")) {
      return { cancelled: true };
    }
    return { cancelled: false, error: message };
  }
}
