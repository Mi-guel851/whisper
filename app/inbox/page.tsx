"use client";

import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { getCachedSession } from "@/lib/supabase/session";
import BackButton from "@/components/BackButton";
import BottomNavigation from "@/components/BottomNavigation";
import GlassPanel from "@/components/GlassPanel";
import FriendsHeader from "@/components/FriendsHeader";
import ChatRow from "@/components/inbox/ChatRow";
import InboxSkeleton from "@/components/inbox/InboxSkeleton";
import InboxChatMenu from "@/components/inbox/InboxChatMenu";
import EmptyState from "@/components/ui/EmptyState";
import { useAnonNames } from "@/lib/anonNames";
import { messagePreviewText } from "@/lib/messagePreview";
import { useChatListState } from "@/lib/chatListActions";
import { presenceManager } from "@/lib/realtime/presence";
import { typingManager } from "@/lib/realtime/typing";
import { Search, X, MessagesSquare, SearchX } from "lucide-react";

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
  /* Selected purely so a spent view-once photo can still be described. The view
     API nulls `image_path` the moment the photo is opened, so without this column
     the row arrives with no content, no image and no audio — nothing left to
     label — and the list rendered an empty line where a message used to be. */
  image_viewed_at: string | null;
  audio_path: string | null;
  audio_viewed_at: string | null;
  /* Sticker/GIF messages: `messagePreviewText` turns these into the
     "💟 Sticker" / "🎞️ GIF" row labels. */
  media_url: string | null;
  media_kind: string | null;
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
  /* Latest missed call per conversation (conversation_id → row), read from the
     `notifications` table (`type = 'message'`, title containing "Missed").
     When the missed call is newer than the latest message, the row advertises
     the call — red glyph, "Missed Voice Call 📞", call timestamp — instead of
     a stale message preview, exactly like WhatsApp's call entries. */
  const [missedCalls, setMissedCalls] = useState<Record<string, { id: string; created_at: string }>>({});
  const [query, setQuery] = useState("");
  const [myId, setMyId] = useState("");
  const [loading, setLoading] = useState(true);
  /* The long-press row menu (Pin / Mark as read), WhatsApp-style. `menuFor`
     is the conversation id whose row is held; `menuAnchor` is the press point
     the sheet anchors to. */
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [menuAnchor, setMenuAnchor] = useState<{ x: number; y: number } | null>(null);
  const { pinned, forcedUnread, togglePinned, markUnread, clearUnread } = useChatListState(myId);
  /* A live ref to the loaded rows so the memoized open/mark-read callbacks can
     tell which participant the caller is (and therefore which read column to
     stamp) without taking `conversations` as a dependency. */
  const conversationsRef = useRef<ConversationRow[]>([]);
  useEffect(() => {
    conversationsRef.current = conversations;
  }, [conversations]);

  /** Which `last_read_at` column belongs to this user for a given conversation. */
  const readColumnFor = useCallback(
    (id: string): "user_a_last_read_at" | "user_b_last_read_at" | null => {
      const row = conversationsRef.current.find((c) => c.id === id);
      if (!row) return null;
      return row.user_a === myId ? "user_a_last_read_at" : "user_b_last_read_at";
    },
    [myId]
  );

  useEffect(() => {
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let missedChannel: ReturnType<typeof supabase.channel> | null = null;
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

        /* One exact row per conversation, straight from the database
           (202609100004). The old windowed query — 600 newest rows across
           every conversation, first row per conversation wins — is correct
           unless one heavy thread fills the whole window, in which case the
           quieter threads get no preview at all and their rows read "Tap to
           open the conversation" instead of their last message. The windowed
           query stays as the fallback for an unmigrated database. */
        const { data: rpcPreviews, error: rpcError } = await supabase.rpc("inbox_message_previews", {
          p_conversation_ids: ids,
        });

        let recent: MessagePreview[] | null = rpcPreviews ?? null;
        if (rpcError || recent === null) {
          if (rpcError) console.warn("inbox_message_previews unavailable, using the windowed query:", rpcError.message);
          const { data: windowed, error: recentError } = await supabase
            .from("direct_messages")
            .select("conversation_id, content, sender_id, is_view_once, image_path, image_viewed_at, audio_path, audio_viewed_at, media_url, media_kind, created_at, delivered_at, read_at")
            .in("conversation_id", ids)
            .order("created_at", { ascending: false })
            .limit(600);
          if (recentError) console.error("Inbox preview fetch error:", recentError);
          recent = windowed;
        }

        const latest: Record<string, MessagePreview> = {};
        for (const message of recent || []) {
          if (!latest[message.conversation_id]) latest[message.conversation_id] = message;
        }

        /* Unread counts come from a single GROUP BY on the database. The old
           shape — `select conversation_id` for every unread row and count in
           JS — fetched one row per unread message, so a 10k-unread backlog
           pulled 10k rows on every inbox paint and on every coalesced
           read-receipt refresh. `unread_message_counts` returns one row per
           conversation (202609070001); the fallback keeps an unmigrated
           database working with the old query. */
        const { data: unread, error: unreadError } = await supabase.rpc("unread_message_counts", {
          conversation_ids: ids,
        });

        const counts: Record<string, number> = {};
        if (!unreadError && unread) {
          for (const row of unread as { conversation_id: string; unread: number }[]) {
            counts[row.conversation_id] = Number(row.unread) || 0;
          }
        } else if (unreadError) {
          console.warn("Inbox unread RPC unavailable, using the row fetch:", unreadError.message);
          const { data: rows } = await supabase
            .from("direct_messages")
            .select("conversation_id")
            .in("conversation_id", ids)
            .neq("sender_id", userId)
            .is("read_at", null);
          for (const message of rows || []) {
            counts[message.conversation_id] = (counts[message.conversation_id] || 0) + 1;
          }
        }

        if (cancelled) return;
        setPreviews(latest);
        setUnreadCounts(counts);
      }

      /* Missed calls, one row per conversation. The server writes them as
         `notifications` (`type = 'message'`, title "Missed Voice Call 📞",
         conversation id in metadata) on every missed/expired transition, so
         the inbox reads them straight from that table — no new pipeline, no
         trigger changes, just a second read next to the message previews. */
      async function loadMissed(uid: string) {
        const { data: missed, error: missedError } = await supabase
          .from("notifications")
          .select("id,created_at,metadata")
          .eq("user_id", uid)
          .eq("type", "message")
          .ilike("title", "%Missed%")
          .order("created_at", { ascending: false })
          .limit(300);

        if (missedError) {
          console.error("Inbox missed-call fetch error:", missedError);
          return;
        }

        const latest: Record<string, { id: string; created_at: string }> = {};
        for (const row of missed || []) {
          const meta = (row.metadata ?? {}) as {
            conversation_id?: string;
            conversationId?: string;
          };
          const conversationId = meta.conversation_id ?? meta.conversationId;
          if (conversationId && !latest[conversationId]) {
            latest[conversationId] = { id: row.id, created_at: row.created_at };
          }
        }
        if (!cancelled) setMissedCalls(latest);
      }

      function subscribeToTyping(rows: ConversationRow[]) {
        /* One broadcast channel per conversation is realtime-socket state and
           it is open for the whole visit to this page. The list is capped at
           the 100 most recent conversations — typing dots are only visible for
           the threads near the top anyway, and an uncapped loop over a user
           with hundreds of conversations is exactly the runaway-subscription
           shape realtime servers do not forgive. */
        rows.slice(0, 100).forEach((row) => {
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

      /* Capped at 300 conversations, newest activity first. An unbounded list
         turns the preview/unread work beneath it into a function of the whole
         social graph, and no inbox is honestly browsed past a few hundred. */
      const { data, error } = await supabase
        .from("conversations")
        .select("id, user_a, user_b, user_a_last_read_at, user_b_last_read_at, last_message_at, last_message_sender_id")
        .or(`user_a.eq.${userId},user_b.eq.${userId}`)
        .order("last_message_at", { ascending: false })
        .limit(300);

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
        void loadMissed(userId);
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
            .order("last_message_at", { ascending: false })
            .limit(300);

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

      /* Missed calls arrive as notification rows, not conversation writes, so
         the channel above never fires for them. This one folds each new
         missed-call row into the map directly — no full refresh for a single
         entry. */
      missedChannel = supabase
        .channel(uniqueChannelName(`inbox-missed-${userId}`))
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "notifications",
            filter: `user_id=eq.${userId}`,
          },
          (payload) => {
            const row = payload.new as {
              id: string;
              type: string;
              title: string;
              created_at: string;
              metadata?: { conversation_id?: string; conversationId?: string } | null;
            };
            if (row.type !== "message" || !row.title?.includes("Missed")) return;
            const conversationId = row.metadata?.conversation_id ?? row.metadata?.conversationId;
            if (!conversationId || cancelled) return;
            setMissedCalls((current) => ({
              ...current,
              [conversationId]: { id: row.id, created_at: row.created_at },
            }));
          }
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
      if (missedChannel) supabase.removeChannel(missedChannel);
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
    /* "Mark as unread" wins over the database: the reader deliberately flipped
       this row back to bold, so it stays bold until they open the chat, even
       though `last_read_at` already says read. The override is cleared on open. */
    if (forcedUnread.has(c.id)) return true;
    const lastRead = c.user_a === myId ? c.user_a_last_read_at : c.user_b_last_read_at;
    /* A missed call newer than both the last message and the last read keeps
       the row bold on its own — the call is activity the user hasn't seen,
       even when every message is read. Opening the chat (or "mark as read")
       stamps `last_read_at`, which clears this the same way it clears
       message unreads. */
    const missed = missedCalls[c.id];
    if (missed && (!lastRead || new Date(missed.created_at) > new Date(lastRead))) {
      const latestMessageAt = previews[c.id]?.created_at ?? c.last_message_at;
      if (!latestMessageAt || new Date(missed.created_at) > new Date(latestMessageAt)) {
        return true;
      }
    }
    if (!c.last_message_at) return false;
    if (c.last_message_sender_id === myId) return false; // you sent it — not unread for you
    if (!lastRead) return true;
    return new Date(c.last_message_at) > new Date(lastRead);
  }

  /* Pinned chats float to the top of the list, WhatsApp-style; within each
     group the existing newest-activity order is preserved. */
  const visibleConversations = useMemo(() => {
    const pinnedRows = conversations.filter((c) => pinned.has(c.id));
    const restRows = conversations.filter((c) => !pinned.has(c.id));
    return [...pinnedRows, ...restRows];
  }, [conversations, pinned]);

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
    if (!needle) return visibleConversations;
    return visibleConversations.filter((c) => {
      const other = c.user_a === myId ? c.user_b : c.user_a;
      return (
        nameOf(other).toLowerCase().includes(needle) ||
        (previews[c.id]?.content || "").toLowerCase().includes(needle) ||
        (missedCalls[c.id] ? "missed voice call 📞".includes(needle) : false)
      );
    });
  }, [visibleConversations, myId, nameOf, previews, missedCalls, query]);

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
     re-render the entire list for a change to one row's timestamp.

     THE READ RECEIPT IS PERSISTED. The old version only rewrote the row in
     local state, so the optimistic "read" look lived in memory and the next
     refetch — the realtime refresh this page fires on any conversation change,
     a reload, or coming back to the tab — showed the unread row again. The
     update below writes `user_x_last_read_at` to the database; the open chat
     also marks each `direct_messages.read_at`, so the inbox unread state and
     the per-message ticks cannot drift. Fire-and-forget: navigation must not
     wait on it, and the optimistic state above is what the user sees. */
  const handleOpenConversation = useCallback(
    (id: string) => {
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
      /* Opening a chat always clears a "marked unread" override. */
      clearUnread(id);

      /* Stamp only THIS user's read column — touching both would mark the
         other participant's inbox read too. The open chat page performs the
         same write as a backstop, so a failure here still self-heals. */
      const column = readColumnFor(id);
      if (myId && column) {
        void supabase
          .from("conversations")
          .update({ [column]: now })
          .eq("id", id)
          .then(({ error }) => {
            if (error) console.error("Inbox: could not persist read receipt:", error.message);
          });
      }

      router.push(`/chat/${id}`);
    },
    [myId, router, clearUnread, readColumnFor]
  );

  /* Persist a "mark as read" from the long-press menu without navigating:
     stamp the conversation read and zero the unread count, same write the open
     path makes. */
  const markConversationRead = useCallback(
    async (id: string) => {
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
      clearUnread(id);
      const column = readColumnFor(id);
      if (!column) return;

      /* Two writes, because the row bold and the count badge read different
         sources. `user_x_last_read_at` drives the bold row; the count badge is
         `direct_messages.read_at is null` (unread_message_counts). Marking only
         the conversation would clear the bold and then the next refetch would
         bring the number badge back. The chat page proves this client update is
         permitted by RLS. Both are fire-and-forget. */
      const { error: convoError } = await supabase
        .from("conversations")
        .update({ [column]: now })
        .eq("id", id);
      if (convoError) console.error("Inbox: could not mark conversation read:", convoError.message);

      const { error: msgsError } = await supabase
        .from("direct_messages")
        .update({ read_at: now })
        .eq("conversation_id", id)
        .neq("sender_id", myId)
        .is("read_at", null);
      if (msgsError) console.error("Inbox: could not mark messages read:", msgsError.message);
    },
    [myId, clearUnread, readColumnFor]
  );

  const handleLongPress = useCallback((id: string, anchor: { x: number; y: number }) => {
    setMenuFor(id);
    setMenuAnchor(anchor);
  }, []);

  const closeMenu = useCallback(() => {
    setMenuFor(null);
    setMenuAnchor(null);
  }, []);

  /* Menu actions. "Mark as unread" is a device-level flag; "Mark as read"
     stamps the database so the badge clears for real. Plain functions rather
     than memoized callbacks — the menu isn't a memoized component, and reading
     the freshest `forcedUnread`/`unreadCounts` matters more than identity. */
  function handleMenuPin() {
    if (menuFor) togglePinned(menuFor);
  }

  function handleMenuToggleRead() {
    if (!menuFor) return;
    const row = conversations.find((c) => c.id === menuFor);
    const currentlyUnread = row ? isUnread(row) : false;
    if (currentlyUnread) {
      /* Bold at the moment of the action → mark read. If it is only unread
         because of a forced-unread override with zero real unread messages,
         clearing the override is enough; otherwise also stamp the database. */
      const count = unreadCounts[menuFor] || 0;
      clearUnread(menuFor);
      if (count > 0) void markConversationRead(menuFor);
    } else {
      markUnread(menuFor);
    }
  }

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
              /* `hover:text-gray-300` compiled to `.hover\:text-gray-300:hover`,
                 which the theme bridge in globals.css does not rewrite — only the
                 bare utilities are in it — so hovering pushed this to a literal
                 light grey on the light theme's light search field. The resting
                 colour is bridged and the hover is an opacity step, which reads
                 the same in both themes. */
              className="shrink-0 text-gray-500 opacity-80 transition-opacity hover:opacity-100"
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
          <GlassPanel className="rounded-3xl">
            <EmptyState
              icon={<MessagesSquare size={26} />}
              title="No conversations yet"
              description="Anyone who whispers you shows up here. Find someone active in Friends and start the first one."
              action={{ label: "Find people", href: "/friends" }}
            />
          </GlassPanel>
        ) : filtered.length === 0 ? (
          <GlassPanel className="rounded-3xl">
            <EmptyState
              icon={<SearchX size={26} />}
              title="No matches"
              description={<>Nothing here matches &ldquo;{query}&rdquo;.</>}
              className="py-8"
            />
          </GlassPanel>
        ) : (
          /* No panel, no dividers — WhatsApp's list. `-mx-4 sm:-mx-6` cancels
             the page container's padding so a row's press fill runs edge to
             edge; each row adds the same padding back inside, so the text still
             lines up with the heading. See `.chat-row` in globals.css. */
          <ul className="-mx-4 sm:-mx-6">
            {filtered.map((c) => {
              const unread = isUnread(c);
              const unreadCount = unreadCounts[c.id] || 0;
              const other = otherUserId(c);
              const active = onlineSet.has(other);
              const typing = typingSet.has(c.id);
              const preview = previews[c.id];
              const sentByMe = preview ? preview.sender_id === myId : false;
              /* A missed call newer than the latest message takes over the
                 row: the red entry, its own timestamp, no ticks — the message
                 preview returns the moment a newer message lands. */
              const missed = missedCalls[c.id];
              const missedIsLatest = Boolean(
                missed &&
                  (!preview || new Date(missed.created_at) > new Date(preview.created_at))
              );

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
                  timestamp={
                    missedIsLatest && missed
                      ? chatListTime(missed.created_at)
                      : chatListTime(c.last_message_at)
                  }
                  previewText={missedIsLatest ? "Missed Voice Call 📞" : previewText(c)}
                  unread={unread}
                  unreadCount={unreadCount}
                  active={active}
                  typing={typing}
                  showTicks={!typing && sentByMe && !!preview && !preview.is_view_once}
                  deliveredAt={preview?.delivered_at ?? null}
                  readAt={preview?.read_at ?? null}
                  pinned={pinned.has(c.id)}
                  missedCall={missedIsLatest}
                  selected={menuFor === c.id}
                  onOpen={handleOpenConversation}
                  onLongPress={handleLongPress}
                />
              );
            })}
          </ul>
        )}
      </div>

      <InboxChatMenu
        open={menuFor !== null}
        anchor={menuAnchor}
        isPinned={menuFor ? pinned.has(menuFor) : false}
        isUnread={
          menuFor
            ? isUnread(
                conversations.find((c) => c.id === menuFor) ??
                  ({ id: menuFor } as ConversationRow)
              )
            : false
        }
        onPin={handleMenuPin}
        onToggleRead={handleMenuToggleRead}
        onClose={closeMenu}
      />
      <BottomNavigation />
    </main>
  );
}
