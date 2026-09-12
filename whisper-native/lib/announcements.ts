import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useRef, useState } from "react";

import { supabase } from "@/lib/supabase";

/**
 * Announcements — the native port of the web app's `lib/announcements.ts`.
 *
 * `active_announcements_for_me()` returns the announcements this account
 * should see right now (the RPC filters kind, window and audience server
 * side). The queue shows them oldest-first, one at a time; "seen" is a
 * device-local set (AsyncStorage here, localStorage there) capped at a
 * hundred ids so a long-lived device doesn't grow it forever. The fetch is
 * floored at thirty minutes, except after a genuine signed-out → signed-in
 * transition — a fresh login must be offered a published announcement
 * regardless of when this device last checked, while a background token
 * refresh must never re-open anything.
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
const REFETCH_FLOOR_MS = 30 * 60 * 1000;

async function readSeen(): Promise<Set<string>> {
  try {
    const raw = await AsyncStorage.getItem(SEEN_KEY);
    return new Set(raw ? raw.split(",").filter(Boolean) : []);
  } catch {
    return new Set();
  }
}

async function writeSeen(ids: Set<string>): Promise<void> {
  try {
    /* Bounded: the newest hundred ids, the web's exact cap. */
    await AsyncStorage.setItem(SEEN_KEY, Array.from(ids).slice(-100).join(","));
  } catch {
    /* Private mode: the dialog can reappear next open — acceptable. */
  }
}

export function useAnnouncements() {
  const [queue, setQueue] = useState<Announcement[]>([]);
  const [current, setCurrent] = useState<Announcement | null>(null);
  const [voting, setVoting] = useState(false);
  const sawSignedOut = useRef(false);

  async function load(ignoreFloor = false) {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) return;

    if (!ignoreFloor) {
      try {
        const last = Number((await AsyncStorage.getItem(LAST_FETCH_KEY)) ?? 0);
        if (last && Date.now() - last < REFETCH_FLOOR_MS) return;
      } catch {
        /* No timestamp is treated as "never fetched" — fall through. */
      }
    }

    const { data, error } = await supabase.rpc("active_announcements_for_me");
    if (error) {
      /* A database without the announcements migration simply stays quiet —
         the same silence the web treats as "nothing to show". */
      if (!`${error.code}`.startsWith("PGRST") && error.code !== "42883") {
        console.warn("[announcements] load failed:", error.message);
      }
      return;
    }

    try {
      await AsyncStorage.setItem(LAST_FETCH_KEY, String(Date.now()));
    } catch {
      /* Same as above. */
    }

    const rows = (Array.isArray(data) ? data : []) as Announcement[];
    const seen = await readSeen();
    /* Oldest first, so a queue of three reads in publication order. */
    const unseen = rows.filter((row) => !seen.has(row.id)).reverse();
    setQueue(unseen);
    setCurrent(unseen[0] ?? null);
  }

  useEffect(() => {
    let cancelled = false;
    void load();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (cancelled) return;
      if (event === "SIGNED_OUT") {
        sawSignedOut.current = true;
        /* The previous account's announcements must not surface after
           sign-out or under the next account. */
        setQueue([]);
        setCurrent(null);
        return;
      }
      if (event === "SIGNED_IN" && sawSignedOut.current) {
        sawSignedOut.current = false;
        void load(true);
      }
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dismiss = useCallback((id: string) => {
    setQueue((previous) => {
      const next = previous.filter((row) => row.id !== id);
      setCurrent(next[0] ?? null);
      void readSeen().then((seen) => {
        seen.add(id);
        void writeSeen(seen);
      });
      return next;
    });
  }, []);

  const vote = useCallback(async (announcementId: string, optionIndex: number): Promise<{ ok: boolean; error?: string }> => {
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
      setCurrent((row) =>
        row && row.id === announcementId
          ? {
              ...row,
              my_vote: result?.my_vote ?? optionIndex,
              total_votes: (row.total_votes ?? 0) + (result?.already_voted ? 0 : 1),
              vote_counts: (() => {
                const counts = [...(row.vote_counts ?? [])];
                if (!result?.already_voted) counts[optionIndex] = (counts[optionIndex] ?? 0) + 1;
                return counts;
              })(),
            }
          : row
      );
      return { ok: true };
    } finally {
      setVoting(false);
    }
  }, []);

  return { current, voting, dismiss, vote };
}
