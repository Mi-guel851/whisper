"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { getCachedSession, onSessionChange } from "@/lib/supabase/session";

/**
 * The client half of the Announcement Center.
 *
 * TWO CALLS, ONCE PER APP OPEN
 *
 * `active_announcements_for_me()` returns the announcements this account should
 * see, already filtered by audience, window and active flag, capped at five rows
 * (202609080002 §A3). Nothing is fetched per announcement and no Realtime
 * channel is opened for any of them — publishing to a million accounts costs one
 * insert server-side and one query per client, which is the entire point of
 * storing announcements as rows instead of fanning them out.
 *
 * WHAT IS STORED LOCALLY, AND WHY
 *
 * "Already seen" lives in localStorage, per announcement id, exactly like
 * components/SocialFollowPrompt.tsx stores which platforms it has asked about.
 * The alternative — an `announcement_views` row per user per announcement — is
 * the fan-out this design exists to avoid, written at the moment of lowest value:
 * a dialog someone glanced at and closed. If per-user delivery receipts are ever
 * actually needed, they belong in a batched endpoint, not here.
 *
 * A bump of STORAGE_VERSION retires the flags from a previous shape, so a
 * re-worded announcement can be shown again without a migration.
 */

export type Announcement = {
  id: string;
  kind: "info" | "poll" | "cta" | "maintenance";
  title: string;
  body: string;
  image_url: string | null;
  cta_label: string | null;
  cta_href: string | null;
  ends_at: string | null;
  published_at: string | null;
  poll_options: string[];
  my_vote: number | null;
  total_votes: number;
  vote_counts: number[];
};

const STORAGE_VERSION = "v1";
const SEEN_KEY = `whisper-announcements-seen-${STORAGE_VERSION}`;
const LAST_FETCH_KEY = `whisper-announcements-fetched-${STORAGE_VERSION}`;

/**
 * Refetch floor. An app open that happens twice in thirty seconds — a reload, a
 * hard back, a native shell resuming — should not cost two queries.
 */
const REFETCH_FLOOR_MS = 30 * 60 * 1000;

function readSeen(): Set<string> {
  try {
    const raw = window.localStorage.getItem(SEEN_KEY);
    return new Set(raw ? raw.split(",").filter(Boolean) : []);
  } catch {
    return new Set();
  }
}

function writeSeen(ids: Set<string>) {
  try {
    /* Bounded: the newest hundred ids. Without a cap this grows one entry per
       announcement forever on a long-lived device. */
    window.localStorage.setItem(SEEN_KEY, Array.from(ids).slice(-100).join(","));
  } catch {
    /* Private mode. The consequence is that the dialog can reappear on the next
       app open, which is a much smaller problem than throwing during render. */
  }
}

export function useAnnouncements() {
  const [queue, setQueue] = useState<Announcement[]>([]);
  const [current, setCurrent] = useState<Announcement | null>(null);
  const [voting, setVoting] = useState(false);
  /* Bumped by a fresh sign-in so the fetch below re-runs even inside the
     30-minute refetch floor — see the cadence comment on `load`. */
  const [armToken, setArmToken] = useState(0);

  useEffect(() => {
    let cancelled = false;

    /* `ignoreFloor` is set only by a genuine signed-out → signed-in
       transition. A user logging in must be offered a published announcement on
       that moment regardless of when this device last checked — the same rule
       the follow-socials prompt follows — whereas an hourly token refresh
       fires the same subscription and must not re-open anything. */
    async function load(ignoreFloor = false) {
      const session = await getCachedSession();
      if (cancelled || !session) return;

      if (!ignoreFloor) {
        try {
          const last = Number(window.localStorage.getItem(LAST_FETCH_KEY));
          if (Number.isFinite(last) && last > 0 && Date.now() - last < REFETCH_FLOOR_MS) return;
        } catch {
          /* No storage; fall through and fetch. */
        }
      }

      const { data, error } = await supabase.rpc("active_announcements_for_me");
      if (cancelled || error) return;

      try {
        window.localStorage.setItem(LAST_FETCH_KEY, String(Date.now()));
      } catch {
        /* Same as above. */
      }

      const rows = (Array.isArray(data) ? data : []) as Announcement[];
      const seen = readSeen();
      /* Oldest first, so a queue of three reads in the order it was published
         rather than showing the newest and burying the two behind it. */
      const unseen = rows.filter((row) => !seen.has(row.id)).reverse();
      setQueue(unseen);
      setCurrent(unseen[0] ?? null);
    }

    void load();

    /* Re-arm on a real sign-in, mirroring components/SocialFollowPrompt.tsx.
       Subscribes to the shared session cache and requires a signed-out state
       first so a token refresh never triggers it. */
    let sawSignedOut = false;
    const unsubscribeSession = onSessionChange((session) => {
      if (!session) {
        sawSignedOut = true;
        /* Clear any queued dialogs so the previous account's announcements
           cannot surface after sign-out or under the next account. */
        setQueue([]);
        setCurrent(null);
        return;
      }
      if (!sawSignedOut) return;
      sawSignedOut = false;
      setArmToken((token) => token + 1);
      void load(true);
    });

    return () => {
      cancelled = true;
      unsubscribeSession();
    };
  }, [armToken]);

  const dismiss = useCallback((id: string) => {
    writeSeen(new Set(readSeen()).add(id));
    setQueue((previous) => {
      const next = previous.filter((row) => row.id !== id);
      setCurrent(next[0] ?? null);
      return next;
    });
  }, []);

  /**
   * Casts a vote.
   *
   * The limit is NOT enforced here. `cast_announcement_vote`
   * (202609080002 §A4) checks that the poll is open, that the caller is in its
   * audience, and that they have not already voted — backed by a unique index on
   * (announcement_id, user_id). A double-tap, a race, or a hand-written request
   * all hit the same wall. What this function does is reflect the answer.
   */
  const vote = useCallback(
    async (announcementId: string, optionIndex: number): Promise<{ ok: boolean; error?: string }> => {
      setVoting(true);
      try {
        const { data, error } = await supabase.rpc("cast_announcement_vote", {
          p_announcement_id: announcementId,
          p_option_index: optionIndex,
        });

        if (error) {
          return { ok: false, error: error.message };
        }

        const result = data as { already_voted?: boolean; my_vote?: number } | null;

        setQueue((previous) =>
          previous.map((row) => {
            if (row.id !== announcementId) return row;
            const counts = [...(row.vote_counts ?? [])];
            /* A repeat vote is not counted again — the server refused it — so
               the tally only moves when the row says the vote is new. */
            if (!result?.already_voted) {
              counts[optionIndex] = (counts[optionIndex] ?? 0) + 1;
            }
            return {
              ...row,
              my_vote: result?.my_vote ?? optionIndex,
              total_votes: (row.total_votes ?? 0) + (result?.already_voted ? 0 : 1),
              vote_counts: counts,
            };
          })
        );
        setCurrent((row) => {
          if (!row || row.id !== announcementId) return row;
          const counts = [...(row.vote_counts ?? [])];
          if (!result?.already_voted) counts[optionIndex] = (counts[optionIndex] ?? 0) + 1;
          return {
            ...row,
            my_vote: result?.my_vote ?? optionIndex,
            total_votes: (row.total_votes ?? 0) + (result?.already_voted ? 0 : 1),
            vote_counts: counts,
          };
        });

        return { ok: true };
      } finally {
        setVoting(false);
      }
    },
    []
  );

  return { current, queueLength: queue.length, voting, dismiss, vote };
}
