import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";
import { AppState, Platform } from "react-native";

/**
 * The Supabase client.
 *
 * SAME PROJECT AS THE WEB APP — same tables, same RLS, same RPCs. Nothing in
 * this file invents a table, a policy or an edge function: the native app is a
 * second client of the backend the web app already speaks to, which is why the
 * queries in `lib/feed.ts`, `lib/dms.ts` and friends are copies of the ones in
 * `lib/feedApi.ts` and `app/inbox/page.tsx` rather than new ones.
 *
 * THREE THINGS DIFFER FROM THE BROWSER CLIENT, AND ALL THREE ARE FORCED
 *
 *  1. `storage: AsyncStorage` instead of localStorage. React Native has no
 *     localStorage, and without a storage adapter the session lives only in
 *     memory and the user is signed out on every cold start.
 *  2. `detectSessionInUrl: false`. There is no URL to parse — the web client
 *     needs it for the OAuth/PKCE redirect, and leaving it on in a native shell
 *     makes supabase-js look for a `window.location` that does not exist.
 *  3. `autoRefreshToken` + an AppState listener. A phone app spends most of its
 *     life backgrounded. Supabase refreshes on a timer that browsers throttle
 *     and native timers simply suspend, so the refresh has to be kicked again
 *     when the app comes back to the foreground or the first request after a
 *     long sleep fails on an expired JWT.
 *
 * The URL and anon key are the same values the deployment uses (see README):
 * `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY`. They default to
 * localhost so a misconfigured build fails loudly at the first request instead
 * of silently talking to nothing.
 */

/* `||` and not `??`: an env var that is present but blank is what an unfilled
   `.env` produces, and `createClient("", "")` throws on import — the app would
   die before it could say what was missing. */
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || "http://localhost:54321";
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || "missing-anon-key";

/**
 * Whether this build was given a backend.
 *
 * Read by the sign-in screen, which says so plainly instead of letting the first
 * request fail with a DNS error against `http://localhost:54321`.
 */
export const hasSupabaseConfig = Boolean(
  process.env.EXPO_PUBLIC_SUPABASE_URL && process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
);

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
});

/**
 * Keeps the access token alive across backgrounding.
 *
 * `startAutoRefresh` is called when the app is active and `stopAutoRefresh`
 * when it is not. This is the pattern Supabase documents for React Native, and
 * it exists because the refresh timer is not trustworthy while the process is
 * suspended — starting it on resume is what makes the token current again
 * before the next query runs.
 */
export function startSupabaseAutoRefresh() {
  if (Platform.OS === "web") return () => {};

  const subscription = AppState.addEventListener("change", (state) => {
    if (state === "active") void supabase.auth.startAutoRefresh();
    else void supabase.auth.stopAutoRefresh();
  });

  if (AppState.currentState === "active") void supabase.auth.startAutoRefresh();

  return () => {
    subscription.remove();
    void supabase.auth.stopAutoRefresh();
  };
}
