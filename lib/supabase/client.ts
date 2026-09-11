import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://localhost:54321";
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "missing-anon-key";

export const hasSupabaseBrowserConfig = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

/**
 * Supabase browser client — 6-hour inactivity session.
 *
 * `persistSession` + `autoRefreshToken` are the defaults, but they are stated
 * explicitly so a future edit cannot silently drop them. `detectSessionInUrl`
 * is what consumes the OAuth `code` on return from Google, and `flowType:
 * "pkce"` is required for that to be secure. Without these, the "6 hours" fix
 * would be incomplete: the token would still refresh, but the redirect after
 * "Continue with Google" would fail to establish a session at all.
 *
 * The 6-hour *inactivity* TTL itself is not a Supabase setting — it's the
 * `SessionKeepAlive` component that stamps `whisper:last-active` and signs out
 * after 6h. The JWT still lives ~1h, but auto-refresh keeps it alive while the
 * user is active or the tab is merely backgrounded briefly.
 */
export const supabase = createClient(url, key, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: "pkce",
    // storage defaults to localStorage; stating it makes the TTL in
    // SessionKeepAlive obvious: we keep localStorage, so the session survives
    // a tab close for up to 6h, not just while the page is held in memory.
    storage: (typeof window !== "undefined" ? window.localStorage : undefined) as any,
  },
});
