"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { useToast } from "./ToastProvider";

type NotificationContextType = {
  unreadCount: number;
  markAllRead: () => Promise<void>;
};

const NotificationContext = createContext<NotificationContextType | null>(null);

export function useNotifications() {
  const context = useContext(NotificationContext);
  if (!context) throw new Error("useNotifications must be used within NotificationProvider");
  return context;
}

export default function NotificationProvider({ children }: { children: React.ReactNode }) {
  const [unreadCount, setUnreadCount] = useState(0);
  const { showToast } = useToast();

  useEffect(() => {
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let active = true;

    async function init() {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session || !active) return;

      const userId = session.user.id;
      const { count } = await supabase
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("is_read", false);

      if (!active) return;
      setUnreadCount(count || 0);

      channel = supabase
        .channel(`notifications-${userId}-${Date.now()}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "notifications",
            filter: `user_id=eq.${userId}`,
          },
          (payload) => {
            const record = payload.new as {
              title: string;
              body: string | null;
              type: string;
            };
            setUnreadCount((current) => current + 1);
            showToast(record.title || "New notification", {
              variant: "info",
            });
          }
        )
        .subscribe();
    }

    init();

    return () => {
      active = false;
      if (channel) supabase.removeChannel(channel);
    };
  }, [showToast]);

  const markAllRead = useCallback(async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) return;

    await supabase
      .from("notifications")
      .update({ is_read: true })
      .eq("user_id", session.user.id)
      .eq("is_read", false);
    setUnreadCount(0);
  }, []);

  return (
    <NotificationContext.Provider value={{ unreadCount, markAllRead }}>
      {children}
    </NotificationContext.Provider>
  );
}
