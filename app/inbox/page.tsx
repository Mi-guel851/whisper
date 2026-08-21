"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { getCachedSession } from "@/lib/supabase/session";
import BackButton from "@/components/BackButton";
import BottomNavigation from "@/components/BottomNavigation";
import GlassPanel from "@/components/GlassPanel";
import FriendsHeader from "@/components/FriendsHeader";
import ChatRow from "@/components/inbox/ChatRow";
import InboxSkeleton from "@/components/inbox/InboxSkeleton";
import { useAnonNames } from "@/lib/anonNames";
import { messagePreviewText } from "@/lib/messagePreview";
import { presenceManager } from "@/lib/realtime/presence";
import { typingManager } from "@/lib/realtime/typing";
import { Search, X } from "lucide-react";

type ConversationRow = {
  id: string;
  user_a: string;
  user_b: string;
  user_a_last_read_at: string | null;
  user_b_last_read_at: string | null;
  last_message_at: string;
  last_message_sender_id: string | null;
};

type MessagePreview = {
  conversation_id: string;
  content: string | null;
  sender_id: string;
  is_view_once: boolean;
  image_path: string | null;
  audio_path: string | null;
  audio_viewed_at: string | null;
  created_at: string;
  delivered_at: string | null;
  read_at: string | null;
};

function uniqueChannelName(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * How long to wait for a burst of realtime events to finish before refetching.
 *
 * One message arriving fires a `conversations` update; a two-way exchange, a
 * read receipt, and a delivery receipt land within a few hundred milliseconds of
 * each other and each fired a full refresh — three queries apiece, one of them a
 * 600-row window. Long enough to collapse a burst, short enough that the list
 * still feels live: the row is already updated optimistically by the time this
 * fires, so this is reconciliation, not the visible update path.
 */
const REFRESH_COALESCE_MS = 250;

/** WhatsApp's chat-list stamp: time today, "Yesterday", a weekday, then a date. */
function chatListTime(value: string) {
  if (!value) return "";
  const date = new Date(value);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const dayDiff = Math.round((startOfToday.getTime() - startOfDate.getTime()) / 86_400_000);

  if (dayDiff === 0) return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (dayDiff === 1) return "Yesterday";
  if (dayDiff < 7) return date.toLocaleDateString(undefined, { weekday: "short" });
  return date.toLocaleDateString(undefined, { day: "2-digit", month: "2-digit", year: "2-digit" });
}

export default function InboxPage() {
  const router = useRouter();
  const [conversations, setConversations] = useState<ConversationRow[]>([]);
  const [friendIds, setFriendIds] = useState<string[]>([]);
  const [onlineUserIds, setOnlineUserIds] = useState<string[]>([]);
  const [typingConversationIds, setTypingConversationIds] = useState<string[]>([]);
  const [previews, setPreviews] = useState<Record<string, MessagePreview>>({});
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});
  const [query, setQuery] = useState("");
  const [myId, setMyId] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let unsubscribePresence: (() => void) | undefined;
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    const typingUnsubscribers = new Map<string, () => void>();
    const typingTimers = new Map<string, ReturnType<typeof setTimeout>>();
    let cancelled = false;

    async function init() {
      const session = await getCachedSession();


      if (!session?.user?.id) {
        setLoading(false);
        return;
      }

      const userId = session.user.id;
      if (!cancelled) setMyId(userId);

      /* Listener first, then connect — and the connect isn't awaited. The manager
         rebuilds its channel on its own after a drop, so registering up front
         means a later rebuild still reaches these dots. Awaiting the handshake
         only delayed the conversation list behind a WebSocket. */
      unsubscribePresence = presenceManager.subscribe((users) => {
        if (!cancelled) setOnlineUserIds(users.map((user) => user.id));
      });
      void presenceManager.connect(userId);

      const { data: friendRows, error: friendsError } = await supabase
        .from("friends")
        .select("friend_id")
        .eq("user_id", userId)
        .order("created_at", { ascending: false });

      if (friendsError) console.error("Inbox friends fetch error:", friendsError);
      if (!cancelled) setFriendIds((friendRows || []).map((row) => row.friend_id));

      // Last-message previews + unread counts, the two things a WhatsApp row shows.
      async function loadPreviews(rows: ConversationRow[]) {
        const ids = rows.map((row) => row.id);
        if (!ids.length) {
          setPreviews({});
          setUnreadCounts({});
          return;
        }

        // One windowed query instead of one per conversation. Newest first, so the
        // first row seen for a conversation is its latest message.
        const { data: recent, error: recentError } = await supabase
          .from("direct_messages")
          .select("conversation_id, content, sender_id, is_view_once, image_path, audio_path, audio_viewed_at, created_at, delivered_at, read_at")
          .in("conversation_id", ids)
          .order("created_at", { ascending: false })
          .limit(600);

        if (recentError) console.error("Inbox preview fetch error:", recentError);

        const latest: Record<string, MessagePreview> = {};
        for (const message of recent || []) {
          if (!latest[message.conversation_id]) latest[message.conversation_id] = message as MessagePreview;
        }

        const { data: unread, error: unreadError } = await supabase
          .from("direct_messages")
          .select("conversation_id")
          .in("conversation_id", ids)
          .neq("sender_id", userId)
          .is("read_at", null);

        if (unreadError) console.error("Inbox unread fetch error:", unreadError);

        const counts: Record<string, number> = {};
        for (const message of unread || []) {
          counts[message.conversation_id] = (counts[message.conversation_id] || 0) + 1;
        }

        if (cancelled) return;
        setPreviews(latest);
        setUnreadCounts(counts);
      }

      function subscribeToTyping(rows: ConversationRow[]) {
        rows.forEach((row) => {
          if (typingUnsubscribers.has(row.id)) return;
          const unsubscribe = typingManager.subscribe(row.id, userId, (typing) => {
            if (typing) {
              setTypingConversationIds((current) => current.includes(row.id) ? current : [...current, row.id]);
              const existingTimer = typingTimers.get(row.id);
              if (existingTimer) clearTimeout(existingTimer);
              typingTimers.set(row.id, setTimeout(() => {
                setTypingConversationIds((current) => current.filter((id) => id !== row.id));
                typingTimers.delete(row.id);
              }, 2200));
            } else {
              const existingTimer = typingTimers.get(row.id);
              if (existingTimer) clearTimeout(existingTimer);
              typingTimers.delete(row.id);
              setTypingConversationIds((current) => current.filter((id) => id !== row.id));
            }
          });
          typingUnsubscribers.set(row.id, unsubscribe);
        });
      }

      const { data, error } = await supabase
        .from("conversations")
        .select("id, user_a, user_b, user_a_last_read_at, user_b_last_read_at, last_message_at, last_message_sender_id")
        .or(`user_a.eq.${userId},user_b.eq.${userId}`)
        .order("last_message_at", { ascending: false });

      if (!cancelled) {
        if (error) console.error("Inbox fetch error:", error);
        setConversations(data || []);
        subscribeToTyping(data || []);
        setFriendIds((current) => [
          ...new Set([
            ...current,
            ...(data || []).map((row) => row.user_a === userId ? row.user_b : row.user_a),
          ]),
        ]);
        setLoading(false);
        void loadPreviews(data || []);
      }

      /* A refresh is three round trips: the conversation list, a 600-row preview
         window, and an unread scan. Realtime hands us one event per row change,
         and a single exchange produces several in quick succession — so the
         events are collapsed into one refresh rather than run per event.

         `refreshRunning` covers the case the timer can't: a burst spread wider
         than the coalesce window, where a second refresh would otherwise start
         while the first is still in flight and the two could land out of order.
         The later one is deferred and re-run once, so the final state always
         reflects the most recent event. */
      let refreshRunning = false;
      let refreshPending = false;

      async function refreshConversations() {
        if (cancelled) return;
        if (refreshRunning) {
          refreshPending = true;
          return;
        }
        refreshRunning = true;

        try {
          const { data: fresh, error: refreshError } = await supabase
            .from("conversations")
            .select("id, user_a, user_b, user_a_last_read_at, user_b_last_read_at, last_message_at, last_message_sender_id")
            .or(`user_a.eq.${userId},user_b.eq.${userId}`)
            .order("last_message_at", { ascending: false });

          if (refreshError) {
            console.error("Inbox refresh error:", refreshError);
          } else if (!cancelled) {
            setConversations(fresh || []);
            subscribeToTyping(fresh || []);
            setFriendIds((current) => [
              ...new Set([
                ...current,
                ...(fresh || []).map((row) => row.user_a === userId ? row.user_b : row.user_a),
              ]),
            ]);
            await loadPreviews(fresh || []);
          }
        } finally {
          refreshRunning = false;
        }

        if (refreshPending && !cancelled) {
          refreshPending = false;
          void refreshConversations();
        }
      }

      function scheduleRefresh() {
        if (refreshTimer) return;
        refreshTimer = setTimeout(() => {
          refreshTimer = null;
          void refreshConversations();
        }, REFRESH_COALESCE_MS);
      }

      channel = supabase
        .channel(uniqueChannelName(`inbox-${userId}`))
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "conversations",
            filter: `user_a=eq.${userId}`,
          },
          scheduleRefresh
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "conversations",
            filter: `user_b=eq.${userId}`,
          },
          scheduleRefresh
        )
        .subscribe();
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user?.id && !cancelled) {
        init();
      }
    });

    init();

    return () => {
      cancelled = true;
      subscription.unsubscribe();
      unsubscribePresence?.();
      if (refreshTimer) clearTimeout(refreshTimer);
      typingUnsubscribers.forEach((unsubscribe) => unsubscribe());
      typingTimers.forEach((timer) => clearTimeout(timer));
      if (channel) supabase.removeChannel(channel);
    };
  }, []);

  function otherUserId(c: ConversationRow) {
    return c.user_a === myId ? c.user_b : c.user_a;
  }

  /* Every row's counterpart in one array, so the whole list resolves its names
     in a single request instead of one per row. */
  const otherIds = useMemo(
    () => conversations.map((c) => (c.user_a === myId ? c.user_b : c.user_a)),
    [conversations, myId]
  );
  const nameOf = useAnonNames(otherIds);

  function labelFor(c: ConversationRow) {
    return nameOf(otherUserId(c));
  }

  function isUnread(c: ConversationRow) {
    if (!c.last_message_at) return false;
    if (c.last_message_sender_id === myId) return false; // you sent it — not unread for you
    const lastRead = c.user_a === myId ? c.user_a_last_read_at : c.user_b_last_read_at;
    if (!lastRead) return true;
    return new Date(c.last_message_at) > new Date(lastRead);
  }

  function previewText(c: ConversationRow) {
    const preview = previews[c.id];
    if (!preview) return "Tap to open the conversation";
    /* `mediaOnly` deliberately: a view-once photo's caption is the *sender's*
       text about a photo the recipient hasn't opened yet, so quoting it in the
       list would leak the framing before the reveal. The media kind is safe. */
    return messagePreviewText(preview, { mediaOnly: preview.is_view_once, fallback: "Message" });
  }

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return conversations;
    return conversations.filter((c) => {
      const other = c.user_a === myId ? c.user_b : c.user_a;
      return (
        nameOf(other).toLowerCase().includes(needle) ||
        (previews[c.id]?.content || "").toLowerCase().includes(needle)
      );
    });
  }, [conversations, myId, nameOf, previews, query]);

  /* Sets for O(1) lookup inside the map. The arrays come from state and change
     often (presence, typing), but the check `array.includes(id)` is O(n) and
     runs once per row. Converting to a Set outside the map means the list pays
     the conversion cost once rather than once per row. */
  const onlineSet = useMemo(() => new Set(onlineUserIds), [onlineUserIds]);
  const typingSet = useMemo(() => new Set(typingConversationIds), [typingConversationIds]);

  /* Bound once so every `ChatRow` can share one function reference — an arrow
     created inside the map would be a new identity per row per render, which
     defeats the memo.

     It takes an id rather than the row, and both state updates are functional
     updaters, so `conversations` is deliberately NOT a dependency. Depending on
     it would give this callback a new identity on every realtime refresh and
     re-render the entire list for a change to one row's timestamp. */
  const handleOpenConversation = useCallback((id: string) => {
    const now = new Date().toISOString();

    setConversations((prev) =>
      prev.map((row) =>
        row.id === id
          ? {
              ...row,
              user_a_last_read_at: row.user_a === myId ? now : row.user_a_last_read_at,
              user_b_last_read_at: row.user_b === myId ? now : row.user_b_last_read_at,
            }
          : row
      )
    );
    setUnreadCounts((prev) => ({ ...prev, [id]: 0 }));
    router.push(`/chat/${id}`);
  }, [myId, router]);

  function openConversation(c: ConversationRow) {
    handleOpenConversation(c.id);
  }

  async function openFriend(friendId: string) {
    const conversation = conversations.find((row) => otherUserId(row) === friendId);
    if (conversation) {
      openConversation(conversation);
      return;
    }

    const userA = myId < friendId ? myId : friendId;
    const userB = myId < friendId ? friendId : myId;
    const { data: existing, error: existingError } = await supabase
      .from("conversations")
      .select("id")
      .eq("user_a", userA)
      .eq("user_b", userB)
      .maybeSingle();

    if (existingError) {
      console.error("Friend conversation lookup error:", existingError);
      return;
    }

    if (existing) {
      router.push(`/chat/${existing.id}`);
      return;
    }

    const { data: created, error: createError } = await supabase
      .from("conversations")
      .insert({
        user_a: userA,
        user_b: userB,
        user_a_label: "Anonymous Friend",
        user_b_label: "Anonymous Friend",
        last_message_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (createError) {
      if (createError.code === "23505") {
        const { data: raceConversation } = await supabase
          .from("conversations")
          .select("id")
          .eq("user_a", userA)
          .eq("user_b", userB)
          .maybeSingle();
        if (raceConversation) router.push(`/chat/${raceConversation.id}`);
      } else {
        console.error("Friend conversation creation error:", createError);
      }
      return;
    }

    if (created) router.push(`/chat/${created.id}`);
  }

  /* The loading state keeps the page shell — heading, search, friends strip —
     and swaps only the list for its skeleton. The previous version replaced the
     entire screen with a centered "Loading...", so arriving at the inbox meant
     watching the layout appear twice: once as bare text, then again as the real
     thing somewhere else entirely. Holding the chrome still and filling in the
     list is what makes the same wait read as fast. */
  return (
    <main className="min-h-screen theme-bg-gradient text-white">
      <div className="max-w-2xl mx-auto px-4 py-8 pb-28 sm:px-6">
        <BackButton />
        <h1 className="page-title mb-1 mt-4">💬 Chats</h1>
        <p className="page-subtitle mb-5">Your anonymous conversations</p>

        {/* Search — WhatsApp keeps it pinned above the list */}
        <div className="mb-5 flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.06] px-3 py-2">
          <Search size={16} className="shrink-0 text-gray-500" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search chats..."
            className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-gray-500"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="shrink-0 text-gray-500 hover:text-gray-300"
              aria-label="Clear search"
            >
              <X size={15} />
            </button>
          )}
        </div>

        <FriendsHeader
          friendIds={friendIds}
          onlineUserIds={onlineUserIds}
          onSelect={openFriend}
        />

        {loading ? (
          <InboxSkeleton />
        ) : conversations.length === 0 ? (
          <GlassPanel className="rounded-3xl p-10 text-center">
            <p className="text-xl">No conversations yet.</p>
            <p className="mt-2 text-sm text-gray-400">
              Go to Friends to find someone active and start chatting.
            </p>
          </GlassPanel>
        ) : filtered.length === 0 ? (
          <GlassPanel className="rounded-3xl p-8 text-center text-sm text-gray-400">
            No chats match &ldquo;{query}&rdquo;.
          </GlassPanel>
        ) : (
          <GlassPanel className="overflow-hidden rounded-3xl">
            <ul className="divide-y divide-white/[0.06]">
              {filtered.map((c) => {
                const unread = isUnread(c);
                const unreadCount = unreadCounts[c.id] || 0;
                const other = otherUserId(c);
                const active = onlineSet.has(other);
                const typing = typingSet.has(c.id);
                const preview = previews[c.id];
                const sentByMe = preview ? preview.sender_id === myId : false;

                /* Everything the row needs is flattened to a primitive here.
                   Passing the conversation object plus the previews map would
                   hand every row a reference that changes whenever any row's
                   data changes, and the memo would never hit. */
                return (
                  <ChatRow
                    key={c.id}
                    conversationId={c.id}
                    avatarUserId={other}
                    label={labelFor(c)}
                    timestamp={chatListTime(c.last_message_at)}
                    previewText={previewText(c)}
                    unread={unread}
                    unreadCount={unreadCount}
                    active={active}
                    typing={typing}
                    showTicks={!typing && sentByMe && !!preview && !preview.is_view_once}
                    deliveredAt={preview?.delivered_at ?? null}
                    readAt={preview?.read_at ?? null}
                    onOpen={handleOpenConversation}
                  />
                );
              })}
            </ul>
          </GlassPanel>
        )}
      </div>
      <BottomNavigation />
    </main>
  );
}
