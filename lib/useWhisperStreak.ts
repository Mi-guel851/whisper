"use client";

import { useEffect, useState } from "react";

import { supabase } from "@/lib/supabase/client";
import { getCachedSession } from "@/lib/supabase/session";

/**
 * The streak check-in, and the only place the streak is read.
 *
 * `whisper_touch_streak()` (migration 202608200003) both records today and returns
 * the resulting streak, so mounting this hook *is* the check-in — there is no
 * separate "record" call that could be skipped or replayed. The server decides
 * which calendar day that is, in the viewer's own timezone, so an evening in
 * Lagos is not filed under tomorrow.
 *
 * The number is computed from a table the browser has no write policy on. That is
 * the whole point: a streak is the one figure a user will work to protect, which
 * makes it the one worth faking, and a client-side counter would mean whatever
 * the last person to open devtools decided it should mean.
 *
 * Returns `null` until it is real. Callers render nothing in that state rather
 * than showing a confident `0`, because "no streak" and "no data" are different
 * claims and only one of them is true before the RPC answers.
 */

/** Kept in step with the `(values ...)` list in whisper_touch_streak(). */
export const STREAK_MILESTONES = [3, 7, 14, 30] as const;

export type WhisperStreak = {
  current: number;
  longest: number;
  /** The milestone crossed on *this* check-in, if any. Reported once, ever. */
  milestone: number | null;
  /** Coins credited for that milestone. Already in the wallet by the time it
      arrives here — the credit happens inside the same function call. */
  coins: number;
};

type StreakRow = {
  current_streak: number | string;
  longest_streak: number | string;
  last_active: string | null;
  started_on: string | null;
  milestone_reached: number | string | null;
  coins_awarded: number | string | null;
};

function num(value: number | string | null | undefined): number {
  const parsed = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** The viewer's zone, so the day boundary matches their evening. */
function localZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/** The next milestone above `current`, or null once all are passed. */
export function nextMilestone(current: number): number | null {
  return STREAK_MILESTONES.find((m) => m > current) ?? null;
}

/**
 * Progress toward the next milestone, 0–1.
 *
 * Measured from the milestone just passed rather than from zero, so the bar
 * restarts at each one instead of creeping asymptotically toward 30 and making
 * days 15 through 29 feel like they achieved nothing.
 */
export function milestoneProgress(current: number): number {
  const target = nextMilestone(current);
  if (!target) return 1;
  const floor = [...STREAK_MILESTONES].reverse().find((m) => m <= current) ?? 0;
  return Math.max(0, Math.min(1, (current - floor) / (target - floor)));
}

export function useWhisperStreak(): WhisperStreak | null {
  const [streak, setStreak] = useState<WhisperStreak | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function checkIn() {
      const session = await getCachedSession();
      if (cancelled || !session) return;

      const { data, error } = await supabase.rpc("whisper_touch_streak", {
        tz: localZone(),
      });
      if (cancelled) return;

      if (error) {
        /* An unapplied migration is the expected failure, not an exception. Any
           other error also leaves this null — a streak nobody can verify is
           worse than no streak. */
        const missing =
          error.code === "42883" ||
          error.code === "PGRST202" ||
          /could not find the function|does not exist/i.test(error.message ?? "");
        console.warn(
          missing
            ? "[streak] whisper_touch_streak() not found — apply supabase/migrations/202608200003_whisper_streaks.sql to enable streaks."
            : `[streak] check-in failed: ${error.message}`
        );
        return;
      }

      const row = (Array.isArray(data) ? data[0] : data) as StreakRow | undefined;
      if (!row) return;

      setStreak({
        current: num(row.current_streak),
        longest: num(row.longest_streak),
        milestone: row.milestone_reached == null ? null : num(row.milestone_reached),
        coins: num(row.coins_awarded),
      });
    }

    void checkIn();
    return () => {
      cancelled = true;
    };
  }, []);

  return streak;
}

export default useWhisperStreak;
