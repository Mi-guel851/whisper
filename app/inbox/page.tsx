"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import BackButton from "@/components/BackButton";
import BottomNavigation from "@/components/BottomNavigation";
import GlassPanel from "@/components/GlassPanel";
import FriendsHeader from "@/components/FriendsHeader";
import { anonymousDisplayName } from "@/lib/anonymousIdentity";
import { presenceManager } from "@/lib/realtime/presence";
import { generatedAvatarUrl } from "@/lib/generatedAvatar";
import { typingManager } from "@/lib/realtime/typing";

type ConversationRow = {
  id: string;
  user_a: string;
  user_b: string;
  user_a_last_read_at: string | null;
  user_b_last_read_at: string | null;
  last_message_at: string;
  last_message_sender_id: string | null;
};

function uniqueChannelName(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export default function InboxPage() {
  const router = useRouter();
  const [conversations, setConversations] = useState<ConversationRow[]>([]);
  const [friendIds, setFriendIds] = useState<string[]>([]);
  const [onlineUserIds, setOnlineUserIds] = useState<string[]>([]);
  const [typingConversationIds, setTypingConversationIds] = useState<string[]>([]);
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
    router.push(`/chat/${c.id}`);
  }

  function openFriend(friendId: string) {
    const conversation = conversations.find((row) => otherUserId(row) === friendId);
    if (conversation) openConversation(conversation);
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
      <div className="max-w-2xl mx-auto px-6 py-10 pb-28">
        <BackButton />
        <h1 className="text-5xl font-black mb-2 mt-4">💬 Inbox</h1>
        <p className="text-gray-400 mb-8">Your anonymous conversations</p>

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
        ) : (
          <div>
            <h2 className="mb-3 px-1 text-lg font-bold text-white">Recent Chats</h2>
            <div className="space-y-3">
            {conversations.map((c) => {
              const unread = isUnread(c);
              const active = onlineUserIds.includes(otherUserId(c));
              const typing = typingConversationIds.includes(c.id);
              return (
                <button key={c.id} onClick={() => openConversation(c)} className="w-full text-left">
                  <GlassPanel className="relative flex items-center gap-4 rounded-2xl p-4 transition hover:bg-white/[0.09]">
                    <div className="relative h-12 w-12 shrink-0">
                      <img
                        src={generatedAvatarUrl(otherUserId(c))}
                        alt=""
                        className="h-12 w-12 rounded-full border border-white/15 bg-white/10 object-cover p-0.5 shadow-lg shadow-black/20"
                        loading="lazy"
                      />
                      <span
                        className={`absolute bottom-0 right-0 h-3.5 w-3.5 rounded-full border-2 border-[#100d18] ${
                          active ? "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]" : "bg-gray-600"
                        }`}
                        aria-label={active ? "Active now" : "Offline"}
                      />
                      {unread && (
                        <span className="absolute -top-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-2 border-black/40 bg-rose-500 shadow-lg shadow-rose-500/40" />
                      )}
                    </div>
                    <div className="flex-1">
                      <p className={`font-semibold ${unread ? "text-white" : "text-gray-300"}`}>
                        {labelFor(c)}
                      </p>
                      <p className={`text-xs ${typing ? "font-semibold text-emerald-400" : unread ? "text-gray-300" : "text-gray-400"}`}>
                        {typing ? "Typing..." : new Date(c.last_message_at).toLocaleString()}
                      </p>
                    </div>
                    {unread && (
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-rose-500 shadow-lg shadow-rose-500/40" />
                    )}
                  </GlassPanel>
                </button>
              );
            })}
            </div>
          </div>
        )}
      </div>
      <BottomNavigation />
    </main>
  );
}