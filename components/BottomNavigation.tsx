"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { House, MessageCircle, Bell, User, Users } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { playNotificationSound } from "@/lib/sound";
import { notificationManager } from "@/lib/realtime/notifications";

export default function BottomNavigation() {
  const pathname = usePathname();
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    let mounted = true;

    async function init() {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session || !mounted) return;

      const { count } = await supabase
        .from("messages")
        .select("*", {
          count: "exact",
          head: true,
        })
        .eq("recipient_id", session.user.id)
        .eq("is_read", false);

      if (mounted) {
        setUnreadCount(count ?? 0);
      }

      notificationManager.connect(session.user.id, () => {
        if (!mounted) return;

        setUnreadCount((c) => c + 1);
        playNotificationSound();
      });
    }

    init();

    return () => {
      mounted = false;
      notificationManager.disconnect();
    };
  }, []);

  async function handleNotificationsClick() {
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session) return;

    const { error } = await supabase
      .from("messages")
      .update({
        is_read: true,
      })
      .eq("recipient_id", session.user.id)
      .eq("is_read", false);

    if (error) {
      console.error(error.message);
      return;
    }

    setUnreadCount(0);
  }

  const nav = [
    { href: "/dashboard", icon: House },
    { href: "/active", icon: Users },
    { href: "/inbox", icon: MessageCircle },
    {
      href: "/notifications",
      icon: Bell,
      badge: unreadCount,
    },
    { href: "/profile", icon: User },
  ];

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 border-t border-white/10 bg-[#090014]/90 backdrop-blur-xl">
      <div className="mx-auto flex max-w-lg justify-around py-3">
        {nav.map((item) => {
          const Icon = item.icon;
          const active = pathname.startsWith(item.href);

          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={
                item.href === "/notifications"
                  ? handleNotificationsClick
                  : undefined
              }
              className={`relative transition ${
                active
                  ? "text-cyan-400"
                  : "text-gray-500 hover:text-white"
              }`}
            >
              <Icon size={27} strokeWidth={2.3} />

              {item.badge !== undefined && item.badge > 0 && (
                <span className="absolute -top-1 -right-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white">
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