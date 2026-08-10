"use client";

import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase/client";
import { getCachedSession, onSessionChange } from "@/lib/supabase/session";
import { presenceManager } from "@/lib/realtime/presence";
import { playNotificationSound } from "@/lib/sound";

/**
 * The bottom navigation's badge counts, held for the lifetime of the app rather
 * than the lifetime of a component.
 *
 * `BottomNavigation` is not in a layout — ten separate pages each mount their
 * own copy. So React unmounted and remounted it on *every* tab switch, and its
 * effects ran again from scratch each time:
 *
 *   getSession → presence connect → unread whispers (count query)
 *   → unread feed (count query) → subscribe channel A
 *   → friends query → unread chats (fetch every conversation) → subscribe channel B
 *
 * That is four queries and two realtime channel joins per tap, in series,
 * before the badges could show anything — so the counts blanked to zero and
 * repopulated a beat later, and the WebSocket spent every navigation
 * re-joining topics it had just left. On a phone that is also radio wakeups and
 * battery, not only latency.
 *
 * None of that work is per-component: the counts are one piece of app state.
 * Kept here, the nav can remount as many times as it likes for free — it reads
 * the current value synchronously on its first render and re-renders only when
 * a number actually changes. Same shape as `presenceManager`, which already
 * solves this for presence.
 *
 * Realtime is subscribed once and never torn down on navigation. `reset()`
 * exists for sign-out, and the store re-arms itself for the new user when the
 * session changes.
 */

export type NavBadges = {
  /** Unread anonymous whispers. */
  whispers: number;
  /** Conversations with unread replies. */
  chats: number;
  /** Unread public-feed notifications. */
  feed: number;
  /** Whether any accepted friend is currently online. */
  friendOnline: boolean;
};

const EMPTY: NavBadges = { whispers: 0, chats: 0, feed: 0, friendOnline: false };

/* Replaced wholesale rather than mutated, because `useSyncExternalStore`
   compares snapshots by identity — an in-place edit would be invisible to it,
   and a fresh object built on every read would loop forever. */
let state: NavBadges = EMPTY;

const listeners = new Set<() => void>();

let started = false;
let userId: string | null = null;
let friendIds = new Set<string>();
let unreadChannel: RealtimeChannel | null = null;
let conversationChannel: RealtimeChannel | null = null;
let stopPresence: (() => void) | null = null;
let stopSessionWatch: (() => void) | null = null;

function emit() {
  listeners.forEach((listener) => listener());
}

/** Publish a partial update, skipping the re-render when nothing moved. */
function patch(next: Partial<NavBadges>) {
  const merged = { ...state, ...next };
  if (
    merged.whispers === state.whispers &&
    merged.chats === state.chats &&
    merged.feed === state.feed &&
    merged.friendOnline === state.friendOnline
  ) {
    return;
  }
  state = merged;
  emit();
}

// ---------------------------------------------------------------------------
// Loaders
// ---------------------------------------------------------------------------

async function loadWhispers(uid: string) {
  const { count } = await supabase
    .from("messages")
    .select("*", { count: "exact", head: true })
    .eq("recipient_id", uid)
    .eq("is_read", false);

  if (uid === userId) patch({ whispers: count || 0 });
}

async function loadFeed(uid: string) {
  const { count } = await supabase
    .from("public_feed_notifications")
    .select("id", { count: "exact", head: true })
    .eq("user_id", uid)
    .eq("is_read", false);

  if (uid === userId) patch({ feed: count || 0 });
}

async function loadChats(uid: string) {
  const { data: convos } = await supabase
    .from("conversations")
    .select(
      "user_a, user_b, user_a_last_read_at, user_b_last_read_at, last_message_at, last_message_sender_id"
    )
    .or(`user_a.eq.${uid},user_b.eq.${uid}`);

  if (uid !== userId) return;

  if (!convos) {
    patch({ chats: 0 });
    return;
  }

  const unread = convos.filter((c) => {
    if (!c.last_message_at) return false;
    if (c.last_message_sender_id === uid) return false;
    const lastRead = c.user_a === uid ? c.user_a_last_read_at : c.user_b_last_read_at;
    if (!lastRead) return true;
    return new Date(c.last_message_at) > new Date(lastRead);
  });

  patch({ chats: unread.length });
}

async function loadFriends(uid: string) {
  const { data } = await supabase.from("friends").select("friend_id").eq("user_id", uid);
  if (uid !== userId) return;

  friendIds = new Set((data || []).map((friend) => friend.friend_id as string));
  patch({ friendOnline: presenceManager.getUsers().some((user) => friendIds.has(user.id)) });
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

function teardown() {
  if (unreadChannel) {
    supabase.removeChannel(unreadChannel);
    unreadChannel = null;
  }
  if (conversationChannel) {
    supabase.removeChannel(conversationChannel);
    conversationChannel = null;
  }
  stopPresence?.();
  stopPresence = null;
  friendIds = new Set();
}

/** Safety net: realtime events can be missed while the tab is backgrounded. */
function refetchAll() {
  if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
  if (!userId) return;
  void loadWhispers(userId);
  void loadChats(userId);
  void loadFeed(userId);
}

async function arm(uid: string) {
  userId = uid;

  /* Counts first and in parallel — these are what the badges show, and there is
     no reason for one to wait on another. Presence and realtime follow; the old
     code awaited the presence handshake *before* the first count query, which
     put a WebSocket round trip in front of every badge on every navigation. */
  void loadWhispers(uid);
  void loadFeed(uid);
  void loadChats(uid);
  void loadFriends(uid);

  unreadChannel = supabase
    .channel(`nav-unread-${uid}`)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "messages", filter: `recipient_id=eq.${uid}` },
      () => {
        patch({ whispers: state.whispers + 1 });
        playNotificationSound();
      }
    )
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "public_feed_notifications",
        filter: `user_id=eq.${uid}`,
      },
      () => void loadFeed(uid)
    )
    .subscribe();

  /* Two filtered handlers, not one unfiltered subscription.
   *
   * `conversations` with no filter means the server fans out every row change
   * in the table — every message anyone in the app sends — to every connected
   * client, and each one of those woke a full refetch here. Realtime filters
   * are single-column, so an `or(user_a, user_b)` filter isn't expressible, but
   * two handlers on the same channel are, and the union is exactly the rows
   * this badge cares about. */
  conversationChannel = supabase
    .channel(`nav-conversations-${uid}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "conversations", filter: `user_a=eq.${uid}` },
      () => void loadChats(uid)
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "conversations", filter: `user_b=eq.${uid}` },
      () => void loadChats(uid)
    )
    .subscribe();

  /* Listener before connect, connect not awaited — the nav's friend-online dot
     picks up the roster whenever the channel settles, including after the
     manager rebuilds a dropped one. */
  stopPresence = presenceManager.subscribe((users) => {
    patch({ friendOnline: users.some((user) => friendIds.has(user.id)) });
  });
  void presenceManager.connect(uid);
}

/**
 * Idempotent. Called by the first subscriber; every later mount is a no-op, so
 * navigating between the ten pages that render the nav costs nothing.
 */
async function start() {
  if (started) return;
  started = true;

  stopSessionWatch = onSessionChange((session) => {
    const nextId = session?.user?.id ?? null;
    if (nextId === userId) return;

    /* A different user (or a sign-out). Drop everything keyed to the old id
       before arming the new one, or the badges would show one account's counts
       against another's. */
    teardown();
    userId = nextId;
    state = EMPTY;
    emit();
    if (nextId) void arm(nextId);
  });

  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", refetchAll);
    window.addEventListener("focus", refetchAll);
  }

  const session = await getCachedSession();
  const uid = session?.user?.id;
  if (!uid || userId === uid) return;

  await arm(uid);
}

/** Full stop, for sign-out. */
export function resetNavBadges() {
  teardown();
  stopSessionWatch?.();
  stopSessionWatch = null;
  if (typeof document !== "undefined") {
    document.removeEventListener("visibilitychange", refetchAll);
    window.removeEventListener("focus", refetchAll);
  }
  userId = null;
  started = false;
  state = EMPTY;
  emit();
}

// ---------------------------------------------------------------------------
// React binding
// ---------------------------------------------------------------------------

export function subscribeNavBadges(listener: () => void) {
  listeners.add(listener);
  void start();
  /* Deliberately does not stop on the last unsubscribe. Surviving the gap
     between one page unmounting and the next mounting is the entire point —
     tearing down here would put us straight back to a rejoin per navigation. */
  return () => {
    listeners.delete(listener);
  };
}

export function getNavBadges(): NavBadges {
  return state;
}
/** Server render has no session, so the badges start hidden and fill in on the client. */
export function getNavBadgesServerSnapshot(): NavBadges {
  return EMPTY;
}
