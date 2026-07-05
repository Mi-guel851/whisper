"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { playNotificationSound } from "@/lib/sound";
import { House, Users, MessageCircle, Activity, User } from "lucide-react";

export default function BottomNavigation() {
  const pathname = usePathname();
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    let channel: ReturnType<typeof supabase.channel> | null = null;

    async function init() {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) return;

      const { count } = await supabase
        .from("messages")
        .select("*", { count: "exact", head: true })
        .eq("recipient_id", session.user.id)
        .eq("is_read", false);

      setUnreadCount(count || 0);

      channel = supabase
        .channel(`bottomnav-unread-${session.user.id}-${Date.now()}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "messages",
            filter: `recipient_id=eq.${session.user.id}`,
          },
          () => {
            setUnreadCount((c) => c + 1);
            playNotificationSound();
          }
        )
        .subscribe();
    }

    init();

    return () => {
      if (channel) supabase.removeChannel(channel);
    };
  }, []);

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

    setUnreadCount(0);
  }

  const nav = [
    { href: "/dashboard", icon: House, label: "Home" },
    { href: "/active", icon: Users, label: "Friends" },
    { href: "/inbox", icon: MessageCircle, label: "Inbox" },
    { href: "/notifications", icon: Activity, label: "Activity", badge: unreadCount },
    { href: "/profile", icon: User, label: "Profile" },
  ];

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 border-t border-white/10 bg-[#090014]/90 backdrop-blur-xl">
      <div className="mx-auto flex max-w-lg justify-around py-3">
        {nav.map((item) => {
          const Icon = item.icon;
          const active = pathname.startsWith(item.href);
          const isActivity = item.href === "/notifications";

          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={isActivity ? handleActivityClick : undefined}
              className={`relative flex flex-col items-center gap-1 text-[10px] font-semibold transition duration-300 ${
                active ? "text-cyan-400" : "text-gray-500 hover:text-white"
              }`}
            >
              <Icon size={24} strokeWidth={2.3} />
              {item.label}

              {"badge" in item && item.badge !== undefined && item.badge > 0 && (
                <span className="absolute -top-1 right-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[9px] font-bold text-white">
                  {item.badge > 9 ? "9+" : item.badge}
                </span>
              )}
            </Link>
          );
        })}
      </div>
    </div>
  );
}