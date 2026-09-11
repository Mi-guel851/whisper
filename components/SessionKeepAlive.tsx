"use client";

import { useEffect } from "react";
import { supabase } from "@/lib/supabase/client";

/**
 * Keeps a signed-in session alive for 6 hours of inactivity.
 *
 * WHY THIS EXISTS
 * Supabase's access token (JWT) lives ~1h, the refresh token lives much longer,
 * but the JS client only refreshes when it is *running*. If the user closes the
 * tab/app for 20 minutes and returns, the token may be expired and the client
 * may have missed its refresh window — the app then treats them as signed out.
 *
 * The product wants: "don't sign me out until I've been gone 6 hours".
 * Supabase cannot do that alone (its JWT TTL is a server setting), so we
 * implement an *inactivity* TTL on top of Supabase's own expiry:
 *   • every time the user is active we stamp `whisper:last-active`
 *   • on visibility/focus we check age; if >6h we sign out, else we touch
 *   • a 5-minute interval proactively refreshes the token while the tab is open
 *
 * This is intentionally client-side and cheap: no extra table, no server change.
 * If the user is gone >6h, next foreground triggers a real signOut so the UI
 * lands on /login and the caller must authenticate again. Until then, we keep
 * refreshing silently.
 */

const LAST_ACTIVE_KEY = "whisper:last-active";
const TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

function now(): number {
  return Date.now();
}

function getLastActive(): number | null {
  try {
    const raw = localStorage.getItem(LAST_ACTIVE_KEY);
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

function touch(): void {
  try {
    localStorage.setItem(LAST_ACTIVE_KEY, String(now()));
  } catch {}
}

function isExpired(): boolean {
  const last = getLastActive();
  if (last === null) return false; // no stamp yet → not expired
  return now() - last > TTL_MS;
}

export default function SessionKeepAlive() {
  useEffect(() => {
    // Initial touch on first mount if there's a session
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) touch();
      else {
        // No session → don't leave a stale stamp that would Expire future logins
        // Keep last-active only while signed in
      }
    });

    // Keep stamp fresh while signed in
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED" || event === "INITIAL_SESSION") {
        if (session) touch();
      }
      if (event === "SIGNED_OUT") {
        try {
          localStorage.removeItem(LAST_ACTIVE_KEY);
        } catch {}
      }
    });

    const onActive = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      if (isExpired()) {
        try {
          await supabase.auth.signOut();
        } catch {}
        try {
          localStorage.removeItem(LAST_ACTIVE_KEY);
        } catch {}
        // Let the individual page's `getCachedSession` redirect handle navigation.
        // Hard reload to ensure all in-memory caches drop the old session.
        window.location.reload();
        return;
      }
      touch();

      // Proactive refresh if token is near expiry (<10 min). Supabase normally
      // does this, but only while the tab is foregrounded — this covers bfcache returns.
      const expiresAt = session.expires_at ? session.expires_at * 1000 : null;
      if (expiresAt && expiresAt - now() < 10 * 60 * 1000) {
        try {
          await supabase.auth.refreshSession();
          touch();
        } catch {}
      }
    };

    const handleVisibility = () => {
      if (document.visibilityState === "visible") void onActive();
    };
    const handleFocus = () => void onActive();
    const handleInteraction = () => {
      // Throttle: touching every keystroke is noisy, every interaction is fine to debounce to 60s
      const last = getLastActive();
      if (last === null || now() - last > 60_000) touch();
    };

    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("focus", handleFocus);
    window.addEventListener("click", handleInteraction, { passive: true });
    window.addEventListener("keydown", handleInteraction, { passive: true });
    window.addEventListener("touchstart", handleInteraction, { passive: true });

    // While the app is open, refresh every 5 min if needed — prevents the "20 min away = logged out"
    const interval = window.setInterval(() => void onActive(), 5 * 60 * 1000);

    return () => {
      sub.subscription.unsubscribe();
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("click", handleInteraction);
      window.removeEventListener("keydown", handleInteraction);
      window.removeEventListener("touchstart", handleInteraction);
      window.clearInterval(interval);
    };
  }, []);

  return null;
}
