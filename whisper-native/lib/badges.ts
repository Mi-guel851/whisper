import { useEffect, useState } from "react";

import { fetchUnreadCount as fetchUnreadAlerts } from "./notifications";
import { fetchUnreadCounts } from "./dms";
import { supabase } from "./supabase";

/**
 * Unread badges, in one store.
 *
 * The tab bar needs four numbers that come from three different tables, and it
 * needs them without owning a query: a tab bar that fetches on mount is a tab
 * bar that refetches on every tab switch. So the counts live here, outliving any
 * single mount, and the bar subscribes.
 *
 * The counts:
 *
 *   unreadMessages   unread direct messages, summed across conversations
 *                    (`unread_message_counts` — one row per conversation, not
 *                    one row per message).
 *   unreadWhispers   unread anonymous whispers (`messages.is_read = false`).
 *   unreadAlerts     unread rows in `notifications`.
 *
 * A realtime subscription keeps them honest: a message arriving while the app is
 * open moves the badge without the user having to visit the tab.
 */

export type Badges = {
  unreadMessages: number;
  unreadWhispers: number;
  unreadAlerts: number;
};

const EMPTY: Badges = { unreadMessages: 0, unreadWhispers: 0, unreadAlerts: 0 };

let current: Badges = EMPTY;
let subscribers = new Set<() => void>();
let refreshPromise: Promise<void> | null = null;
let channel: ReturnType<typeof supabase.channel> | null = null;
let watching: string | null = null;

function notify() {
  for (const subscriber of subscribers) subscriber();
}

function setBadges(next: Partial<Badges>) {
  const merged = { ...current, ...next };
  if (
    merged.unreadMessages === current.unreadMessages &&
    merged.unreadWhispers === current.unreadWhispers &&
    merged.unreadAlerts === current.unreadAlerts
  ) {
    return;
  }
  current = merged;
  notify();
}

/** Reads all three counts. Coalesced, so three calls in one tick cost one read. */
export function refreshBadges(userId: string): Promise<void> {
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    try {
      const [whispers, alerts, conversations] = await Promise.all([
        supabase
          .from("messages")
          .select("id", { count: "exact", head: true })
          .eq("recipient_id", userId)
          .eq("is_read", false),
        fetchUnreadAlerts(userId),
        supabase.from("conversations").select("id").or(`user_a.eq.${userId},user_b.eq.${userId}`).limit(300),
      ]);

      const conversationIds = (conversations.data ?? []).map((row) => (row as { id: string }).id);
      const unread = await fetchUnreadCounts(conversationIds, userId);

      setBadges({
        unreadWhispers: whispers.count ?? 0,
        unreadAlerts: alerts,
        unreadMessages: Object.values(unread).reduce((total, value) => total + value, 0),
      });
    } catch (error) {
      /* A badge is not worth an error banner. The next refresh — a realtime
         event, a tab focus, a manual pull — will try again. */
      console.warn("[badges] refresh failed:", error);
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

/**
 * Starts the realtime subscriptions for one user.
 *
 * One channel for `direct_messages` and one for `messages`; both are
 * insert-only because that is the only event that can raise a badge.
 */
export function watchBadges(userId: string): () => void {
  if (watching === userId) return () => {};

  stopWatching();
  watching = userId;

  void refreshBadges(userId);

  channel = supabase
    .channel(`badges-${userId}`)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "direct_messages" },
      () => void refreshBadges(userId)
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "messages", filter: `recipient_id=eq.${userId}` },
      () => void refreshBadges(userId)
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
      () => void refreshBadges(userId)
    )
    .subscribe();

  return stopWatching;
}

function stopWatching() {
  if (channel) supabase.removeChannel(channel);
  channel = null;
  watching = null;
}

/** Clears every badge — used on sign-out. */
export function resetBadges() {
  stopWatching();
  setBadges(EMPTY);
}

/** Subscribe to the counts. */
export function subscribeBadges(listener: () => void) {
  subscribers.add(listener);
  return () => {
    subscribers.delete(listener);
  };
}

export function getBadges(): Badges {
  return current;
}

/**
 * The badge counts, live.
 *
 * `watchBadges` is the caller's job (the root navigator starts it once a session
 * exists) — this hook only reads.
 */
export function useBadges(): Badges {
  const [badges, setLocal] = useState<Badges>(current);

  useEffect(() => {
    setLocal(current);
    return subscribeBadges(() => setLocal(current));
  }, []);

  return badges;
}

