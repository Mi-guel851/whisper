"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { supabase } from "@/lib/supabase/client";
import { getCachedSession } from "@/lib/supabase/session";

/**
 * The streak: read on mount, written only by an explicit check-in.
 *
 * The previous version made *mounting this hook* the check-in — the RPC recorded
 * today as a side effect of being asked what the streak was. That is a visit
 * counter wearing a streak's clothes: the user could never do anything to keep
 * it, so it measured nothing they chose. Now there are two RPCs (migration
 * 202608220001):
 *
 *   `whisper_streak_status` — read-only, safe on every mount.
 *   `whisper_check_in`      — the only writer, called from a button the user taps.
 *
 * Both are computed from tables the browser has no write policy on. That is the
 * whole point: a streak is the one figure a user will work to protect, which
 * makes it the one worth faking, and a client-side counter would mean whatever
 * the last person to open devtools decided it should mean. The server also owns
 * the calendar day, in the viewer's own timezone, so an evening in Lagos is not
 * filed under tomorrow.
 *
 * `streak` is `null` only while the first read is in flight or if it failed — not
 * for a user who has never checked in, who gets a genuine row of zeros. "No
 * streak" and "no data" are different claims and callers need to tell them apart:
 * the first should render a check-in button, the second nothing at all.
 */

/** Mirrors the constants in whisper_check_in(). The server is authoritative —
    these are the values used before the first response lands. */
export const STREAK_CYCLE_DAYS = 7;
export const STREAK_CYCLE_COINS = 4;

export type WhisperStreak = {
  /** Days into the current reward cycle, 0…cycleLength. */
  cycleDay: number;
  /** Days per cycle, from the server. */
  cycleLength: number;
  /** Coins paid when a cycle completes, from the server. */
  cycleCoins: number;
  /** Consecutive calendar days checked in. Uncapped, so it can exceed a cycle. */
  run: number;
  /** Best `run` ever. */
  longest: number;
  /** How many full cycles have been paid out. */
  cyclesCompleted: number;
  /** True once today's check-in is recorded. Drives the button's disabled state. */
  checkedInToday: boolean;
};

/** What a completed cycle pays. Non-null only on the check-in that finished it. */
export type StreakReward = {
  coins: number;
  /** Which cycle this was — 1 for the first, 2 for the next, and so on. */
  cycle: number;
};

type StreakRow = {
  cycle_day: number | string | null;
  cycle_length: number | string | null;
  cycle_coins: number | string | null;
  run_length: number | string | null;
  longest_run: number | string | null;
  cycles_completed: number | string | null;
  last_check_in: string | null;
  checked_in_today: boolean | null;
  awarded_coins: number | string | null;
  cycle_completed: boolean | null;
};

function num(value: number | string | null | undefined, fallback = 0): number {
  if (value == null) return fallback;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** The viewer's zone, so the day boundary matches their evening. */
function localZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function toStreak(row: StreakRow): WhisperStreak {
  return {
    cycleDay: num(row.cycle_day),
    cycleLength: num(row.cycle_length, STREAK_CYCLE_DAYS) || STREAK_CYCLE_DAYS,
    cycleCoins: num(row.cycle_coins, STREAK_CYCLE_COINS) || STREAK_CYCLE_COINS,
    run: num(row.run_length),
    longest: num(row.longest_run),
    cyclesCompleted: num(row.cycles_completed),
    checkedInToday: row.checked_in_today === true,
  };
}

/**
 * True when the failure is "the migration hasn't been applied", which is an
 * expected deployment state rather than a bug. Kept separate so the console says
 * which file to run instead of a generic RPC error.
 */
function isMissingFunction(error: { code?: string; message?: string }): boolean {
  return (
    error.code === "42883" ||
    error.code === "PGRST202" ||
    /could not find the function|does not exist/i.test(error.message ?? "")
  );
}

const MIGRATION_HINT =
  "apply supabase/migrations/202608220001_streak_check_in_cycle.sql to enable streaks.";

export type UseWhisperStreak = {
  streak: WhisperStreak | null;
  /** Records today. Resolves to the reward if this check-in completed a cycle. */
  checkIn: () => Promise<StreakReward | null>;
  checkingIn: boolean;
  /** The reward awaiting acknowledgement, for the celebration dialog. */
  reward: StreakReward | null;
  dismissReward: () => void;
};

export function useWhisperStreak(): UseWhisperStreak {
  const [streak, setStreak] = useState<WhisperStreak | null>(null);
  const [checkingIn, setCheckingIn] = useState(false);
  const [reward, setReward] = useState<StreakReward | null>(null);

  /* Guards a double-tap that beats the `checkingIn` re-render. The server is
     idempotent per day regardless, so the worst this prevents is a wasted round
     trip — but it also stops two responses racing to set state out of order. */
  const inFlight = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function read() {
      const session = await getCachedSession();
      if (cancelled || !session) return;

      const { data, error } = await supabase.rpc("whisper_streak_status", {
        tz: localZone(),
      });
      if (cancelled) return;

      if (error) {
        console.warn(
          isMissingFunction(error)
            ? `[streak] whisper_streak_status() not found — ${MIGRATION_HINT}`
            : `[streak] read failed: ${error.message}`
        );
        return;
      }

      const row = (Array.isArray(data) ? data[0] : data) as StreakRow | undefined;
      if (!row) return;
      setStreak(toStreak(row));
    }

    void read();
    return () => {
      cancelled = true;
    };
  }, []);

  const checkIn = useCallback(async (): Promise<StreakReward | null> => {
    if (inFlight.current) return null;
    inFlight.current = true;
    setCheckingIn(true);

    try {
      const { data, error } = await supabase.rpc("whisper_check_in", {
        tz: localZone(),
      });

      if (error) {
        console.warn(
          isMissingFunction(error)
            ? `[streak] whisper_check_in() not found — ${MIGRATION_HINT}`
            : `[streak] check-in failed: ${error.message}`
        );
        return null;
      }

      const row = (Array.isArray(data) ? data[0] : data) as StreakRow | undefined;
      if (!row) return null;

      const next = toStreak(row);
      if (mounted.current) setStreak(next);

      /* `cycle_completed` is the server's word for it, and `awarded_coins` is
         what actually landed in the wallet. Both are required: a cycle that
         completed but lost the payout race reports 0 coins, and announcing coins
         that were not credited is worse than announcing nothing. */
      const coins = num(row.awarded_coins);
      if (row.cycle_completed === true && coins > 0) {
        const earned: StreakReward = { coins, cycle: next.cyclesCompleted };
        if (mounted.current) setReward(earned);
        return earned;
      }
      return null;
    } finally {
      inFlight.current = false;
      if (mounted.current) setCheckingIn(false);
    }
  }, []);

  const dismissReward = useCallback(() => setReward(null), []);

  return { streak, checkIn, checkingIn, reward, dismissReward };
}

export default useWhisperStreak;
