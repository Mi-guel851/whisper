"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { getCachedSession, onSessionChange } from "@/lib/supabase/session";

/**
 * The caller's ban status, and nothing else.
 *
 * Reads `public.my_ban_status()` (202609080001 §B1a), a definer RPC granted to
 * `authenticated` that returns at most one row about the caller. `user_bans`
 * itself has RLS enabled with no client policy, so this function is the only way
 * a browser can learn that a ban exists — and it can only ever learn about its
 * own.
 *
 * WHY THERE IS NO MIDDLEWARE CHECK
 *
 * The obvious place for a server-side gate is `middleware.ts`. It cannot work in
 * this app: `lib/supabase/client.ts` uses the default browser storage, so the
 * session lives in localStorage and no auth cookie is ever sent with a
 * navigation. `@supabase/ssr` is in package.json and imported nowhere. A
 * middleware that "checks the session" here would be checking nothing and
 * reading as a guarantee it does not provide.
 *
 * The enforcement that does exist, and is the real one, is in the database:
 * before-insert triggers on `messages`, `direct_messages`,
 * `public_feed_posts`, `public_feed_likes`, `message_reactions` and
 * `coin_transactions`, plus the ban clause in `can_send_direct_message`. Those
 * fire for a request from this app, from devtools, or from curl alike.
 *
 * What this hook is for is the honest part: telling the person what happened,
 * instead of letting them press send and watch it fail.
 */

export type BanStatus = {
  banned: boolean;
  reason: string | null;
  duration: "permanent" | "temporary" | null;
  expiresAt: string | null;
  createdAt: string | null;
};

const NOT_BANNED: BanStatus = {
  banned: false,
  reason: null,
  duration: null,
  expiresAt: null,
  createdAt: null,
};

/**
 * How often to re-check while the tab is open.
 *
 * A ban takes effect immediately for anything that matters, because the triggers
 * do not consult this hook. This interval only governs how long a banned account
 * keeps looking at a dashboard it can no longer use — 60 seconds is the
 * difference between "promptly told" and "one query per account per minute", and
 * the query is a single-row index probe.
 */
const RECHECK_MS = 60_000;

export function useBanStatus(): BanStatus & { checking: boolean; recheck: () => void } {
  const [status, setStatus] = useState<BanStatus>(NOT_BANNED);
  const [checking, setChecking] = useState(true);
  const [tick, setTick] = useState(0);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const session = await getCachedSession();
      if (cancelled || !alive.current) return;

      if (!session) {
        setStatus(NOT_BANNED);
        setChecking(false);
        return;
      }

      const { data, error } = await supabase.rpc("my_ban_status");
      if (cancelled || !alive.current) return;

      /* A database that has not had 202609080001 applied has no such function.
         Treated as "not banned" rather than as an error, because the alternative
         is blocking every signed-in user on a missing migration — and the
         triggers, which are the actual gate, would be missing too. */
      if (error) {
        setStatus(NOT_BANNED);
        setChecking(false);
        return;
      }

      const row = Array.isArray(data) ? data[0] : data;
      if (!row || row.banned !== true) {
        setStatus(NOT_BANNED);
        setChecking(false);
        return;
      }

      setStatus({
        banned: true,
        reason: (row.reason as string | null) ?? null,
        duration: (row.duration as BanStatus["duration"]) ?? null,
        expiresAt: (row.expires_at as string | null) ?? null,
        createdAt: (row.created_at as string | null) ?? null,
      });
      setChecking(false);
    }

    void load();

    const interval = window.setInterval(() => void load(), RECHECK_MS);
    /* Re-checked on a sign-in or a token refresh, so a ban issued while the tab
       was open is picked up without waiting out the interval. */
    const unsubscribe = onSessionChange(() => void load());

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      unsubscribe();
    };
  }, [tick]);

  /* In a callback rather than at the top of the effect: flipping `checking` back
     on is a response to the caller asking, not part of subscribing. */
  const recheck = useCallback(() => {
    setChecking(true);
    setTick((n) => n + 1);
  }, []);

  return { ...status, checking, recheck };
}

/** "September 20, 2026 at 4:12 PM" — used on the ban screen. */
export function formatBanExpiry(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
