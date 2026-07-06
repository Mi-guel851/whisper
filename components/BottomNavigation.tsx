"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { playNotificationSound } from "@/lib/sound";
import { useToast } from "@/components/ToastProvider";
import { presenceManager } from "@/lib/realtime/presence";
import { House, Users, MessageCircle, User, Lightbulb } from "lucide-react";

function uniqueChannelName(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export default function BottomNavigation() {
  const pathname = usePathname();
  const { showToast } = useToast();
  const [unreadWhispers, setUnreadWhispers] = useState(0);
  const [unreadChats, setUnreadChats] = useState(0);
  const [myId, setMyId] = useState<string | null>(null);
  const [anyoneElseOnline, setAnyoneElseOnline] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    async function init() {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session || cancelled) return;

      setMyId(session.user.id);

      const { count } = await supabase
        .from("messages")
        .select("*", { count: "exact", head: true })
        .eq("recipient_id", session.user.id)
        .eq("is_read", false);

      if (cancelled) return;
      setUnreadWhispers(count || 0);

      channel = supabase
        .channel(uniqueChannelName(`bottomnav-unread-${session.user.id}`))
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "messages",
            filter: `recipient_id=eq.${session.user.id}`,
          },
          () => {
            setUnreadWhispers((c) => c + 1);
            playNotificationSound();
          }
        )
        .subscribe();
    }

    init();

    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
    };
  }, []);

  // Friends green dot — reuses the shared presence singleton, no new channel opened
  useEffect(() => {
    if (!myId) return;

    const unsubscribe = presenceManager.subscribe((users) => {
      const othersOnline = users.some((u) => u.id !== myId);
      setAnyoneElseOnline(othersOnline);
    });

    return unsubscribe;
  }, [myId]);

  // Inbox red dot — any conversation with unread replies
  useEffect(() => {
    if (!myId) return;

    let cancelled = false;

    async function loadUnreadChats() {
      const { data: convos } = await supabase
        .from("conversations")
        .select("user_a, user_b, user_a_last_read_at, user_b_last_read_at, last_message_at")
        .or(`user_a.eq.${myId},user_b.eq.${myId}`);

      if (cancelled || !convos) {
        if (!cancelled) setUnreadChats(0);
        return;
      }

      const unread = convos.filter((c) => {
        const lastRead = c.user_a === myId ? c.user_a_last_read_at : c.user_b_last_read_at;
        if (!c.last_message_at) return false;
        if (!lastRead) return true;
        return new Date(c.last_message_at) > new Date(lastRead);
      });

      if (!cancelled) setUnreadChats(unread.length);
    }

    loadUnreadChats();

    const channel = supabase
      .channel(uniqueChannelName(`bottomnav-chat-unread-${myId}`))
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "conversations" },
        () => loadUnreadChats()
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [myId]);

  async function handleActivityClick() {
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session) return;

    const { error } = await supabase
      .from("messages")
      .update({ is_read: true })
      .eq("recipient_id", session.user.id)
      .eq("is_read", false);

    if (error) {
      console.error("Failed to mark as read:", error.message);
      return;
    }

    setUnreadWhispers(0);
  }

  function handleHintClick() {
    showToast("✨ Premium features coming soon — get ready!");
  }

  const nav = [
    { href: "/dashboard", icon: House, label: "Home", showPresenceDot: false, badge: undefined },
    { href: "/active", icon: Users, label: "Friends", showPresenceDot: true, badge: undefined },
    { href: "/inbox", icon: MessageCircle, label: "Inbox", showPresenceDot: false, badge: unreadChats },
    { href: "/notifications", icon: null, label: "Whispers", showPresenceDot: false, badge: unreadWhispers },
    { href: "/profile", icon: User, label: "Profile", showPresenceDot: false, badge: undefined },
  ];

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 border-t border-white/10 bg-[#090014]/90 backdrop-blur-xl">
      <div className="mx-auto flex max-w-lg justify-around py-2.5">
        {nav.map((item) => {
          const Icon = item.icon;
          const active = pathname.startsWith(item.href);
          const isActivity = item.href === "/notifications";

          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={isActivity ? handleActivityClick : undefined}
              className="relative flex flex-col items-center gap-1 text-[10px] font-semibold transition duration-300"
            >
              <div
                className={`flex h-9 w-9 items-center justify-center rounded-full transition-all duration-300 ${
                  active
                    ? "bg-gradient-to-br from-purple-500 to-cyan-400"
                    : "bg-transparent"
                }`}
              >
                {Icon ? (
                  <Icon
                    size={20}
                    strokeWidth={2.3}
                    className={active ? "text-black" : "text-gray-500"}
                  />
                ) : (
                  <Image
                    src="/ghost.png"
                    alt="Whispers"
                    width={20}
                    height={20}
                    className={active ? "" : "opacity-60"}
                  />
                )}

                {item.showPresenceDot && anyoneElseOnline && (
                  <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-[#090014] bg-green-400" />
                )}

                {item.badge !== undefined && item.badge > 0 && (
                  <span className="absolute -top-1 right-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[9px] font-bold text-white">
                    {item.badge > 9 ? "9+" : item.badge}
                  </span>
                )}
              </div>

              <span className={active ? "text-white" : "text-gray-500"}>
                {item.label}
              </span>
            </Link>
          );
        })}

        <button
          onClick={handleHintClick}
          className="relative flex flex-col items-center gap-1 text-[10px] font-semibold text-gray-500 transition duration-300"
        >
          <div className="flex h-9 w-9 items-center justify-center rounded-full">
            <Lightbulb size={20} strokeWidth={2.3} className="text-yellow-400/80" />
          </div>
          <span>Hint</span>
        </button>
      </div>
    </div>
  );
}