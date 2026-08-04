"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import BackButton from "@/components/BackButton";
import BottomNavigation from "@/components/BottomNavigation";
import GlassPanel from "@/components/GlassPanel";
import FriendsHeader from "@/components/FriendsHeader";
import MessageTicks from "@/components/MessageTicks";
import { anonymousDisplayName } from "@/lib/anonymousIdentity";
import { presenceManager } from "@/lib/realtime/presence";
import { generatedAvatarUrl } from "@/lib/generatedAvatar";
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
  created_at: string;
  delivered_at: string | null;
  read_at: string | null;
};

function uniqueChannelName(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

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
    const typingUnsubscribers = new Map<string, () => void>();
    const typingTimers = new Map<string, ReturnType<typeof setTimeout>>();
    let cancelled = false;

    async function init() {
      const { data: { session } } = await supabase.auth.getSession();

      if (!session?.user?.id) {
        setLoading(false);
        return;
      }

      const userId = session.user.id;
      if (!cancelled) setMyId(userId);

      await presenceManager.connect(userId);
      unsubscribePresence = presenceManager.subscribe((users) => {
        if (!cancelled) setOnlineUserIds(users.map((user) => user.id));
      });

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
          .select("conversation_id, content, sender_id, is_view_once, created_at, delivered_at, read_at")
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

      async function refreshConversations() {
        if (cancelled) return;
        const { data: fresh, error: refreshError } = await supabase
          .from("conversations")
          .select("id, user_a, user_b, user_a_last_read_at, user_b_last_read_at, last_message_at, last_message_sender_id")
          .or(`user_a.eq.${userId},user_b.eq.${userId}`)
          .order("last_message_at", { ascending: false });

        if (refreshError) {
          console.error("Inbox refresh error:", refreshError);
          return;
        }

        if (!cancelled) {
          setConversations(fresh || []);
          subscribeToTyping(fresh || []);
          setFriendIds((current) => [
            ...new Set([
              ...current,
              ...(fresh || []).map((row) => row.user_a === userId ? row.user_b : row.user_a),
            ]),
          ]);
          void loadPreviews(fresh || []);
        }
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
          refreshConversations
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "conversations",
            filter: `user_b=eq.${userId}`,
          },
          refreshConversations
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
      typingUnsubscribers.forEach((unsubscribe) => unsubscribe());
      typingTimers.forEach((timer) => clearTimeout(timer));
      if (channel) supabase.removeChannel(channel);
    };
  }, []);

  function otherUserId(c: ConversationRow) {
    return c.user_a === myId ? c.user_b : c.user_a;
  }

  function labelFor(c: ConversationRow) {
    return anonymousDisplayName(otherUserId(c));
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
    if (preview.is_view_once) return "📷 Photo";
    return preview.content || "Message";
  }

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return conversations;
    return conversations.filter((c) => {
      const other = c.user_a === myId ? c.user_b : c.user_a;
      return (
        anonymousDisplayName(other).toLowerCase().includes(needle) ||
        (previews[c.id]?.content || "").toLowerCase().includes(needle)
      );
    });
  }, [conversations, myId, previews, query]);

  function openConversation(c: ConversationRow) {
    setConversations((prev) =>
      prev.map((row) =>
        row.id === c.id
          ? {
              ...row,
              user_a_last_read_at: row.user_a === myId ? new Date().toISOString() : row.user_a_last_read_at,
              user_b_last_read_at: row.user_b === myId ? new Date().toISOString() : row.user_b_last_read_at,
            }
          : row
      )
    );
    setUnreadCounts((prev) => ({ ...prev, [c.id]: 0 }));
    router.push(`/chat/${c.id}`);
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

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center theme-bg-gradient text-white">
        <p className="text-gray-400">Loading...</p>
      </main>
    );
  }

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

        {conversations.length === 0 ? (
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
                const active = onlineUserIds.includes(otherUserId(c));
                const typing = typingConversationIds.includes(c.id);
                const preview = previews[c.id];
                const sentByMe = preview ? preview.sender_id === myId : false;

                return (
                  <li key={c.id}>
                    <button
                      onClick={() => openConversation(c)}
                      className="flex w-full items-center gap-3 px-3 py-3 text-left transition hover:bg-white/[0.05]"
                    >
                      <div className="relative h-12 w-12 shrink-0">
                        <img
                          src={generatedAvatarUrl(otherUserId(c))}
                          alt=""
                          className="h-12 w-12 rounded-full border border-white/15 bg-white/10 object-cover p-0.5"
                          loading="lazy"
                        />
                        <span
                          className={`absolute bottom-0 right-0 h-3.5 w-3.5 rounded-full border-2 border-[#100d18] ${
                            active ? "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]" : "bg-gray-600"
                          }`}
                          aria-label={active ? "Active now" : "Offline"}
                        />
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline gap-2">
                          <p className={`min-w-0 flex-1 truncate text-[15px] ${unread ? "font-bold text-white" : "font-semibold text-gray-200"}`}>
                            {labelFor(c)}
                          </p>
                          <span className={`shrink-0 text-[11px] ${unread ? "font-bold text-emerald-400" : "text-gray-500"}`}>
                            {chatListTime(c.last_message_at)}
                          </span>
                        </div>

                        <div className="mt-0.5 flex items-center gap-1.5">
                          {/* Your own last message carries its ticks, like WhatsApp. */}
                          {!typing && sentByMe && preview && !preview.is_view_once && (
                            <MessageTicks deliveredAt={preview.delivered_at} readAt={preview.read_at} />
                          )}
                          <p
                            className={`min-w-0 flex-1 truncate text-[13px] ${
                              typing ? "font-semibold text-emerald-400" : unread ? "text-gray-200" : "text-gray-500"
                            }`}
                          >
                            {typing ? "typing..." : previewText(c)}
                          </p>
                          {unreadCount > 0 && (
                            <span className="flex h-5 min-w-[20px] shrink-0 items-center justify-center rounded-full bg-emerald-500 px-1.5 text-[11px] font-black text-black">
                              {unreadCount > 99 ? "99+" : unreadCount}
                            </span>
                          )}
                        </div>
                      </div>
                    </button>
                  </li>
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