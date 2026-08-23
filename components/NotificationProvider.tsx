"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { subscribeToConnectivity } from "@/lib/offline";
import { useToast } from "./ToastProvider";

/**
 * The unread-notification count, and the toast that announces new ones.
 *
 * WHY IT USED TO GO STALE, AND WHY THAT LOOKED LIKE BROKEN NOTIFICATIONS
 *
 * The count was read exactly once, on mount, and everything after that came from
 * a realtime channel. Postgres changes are not replayed — a channel that was down
 * when a row was inserted never hears about it — so any notification that arrived
 * while the device was offline, asleep, or between subscriptions was invisible to
 * the badge forever. Worse, a provider that mounted *while* offline got `count: 0`
 * and no subscription at all, and stayed at zero until the app was fully
 * restarted with a connection.
 *
 * That is the in-app half of "notifications don't fire". The tray half is FCM's
 * job and already works: Google queues an undelivered high-priority message and
 * releases it on reconnect, with no help from this file. What was missing was the
 * app agreeing with the tray once it came back.
 *
 * So the count is now re-read at every moment it could have drifted:
 *
 *   reconnect            the gap this whole note is about
 *   tab/app foregrounded a backgrounded WebView has its socket reaped by Android,
 *                        so returning to the app is the same problem as reconnecting
 *   channel resubscribe  a socket that dropped and recovered missed whatever
 *                        landed in between, so the count is refetched, not trusted
 *
 * A recount is one indexed `count` query against a single user's rows. Cheap
 * enough to prefer over any attempt to reconcile what the channel might have
 * missed, which is guesswork by comparison.
 */

type NotificationContextType = {
  unreadCount: number;
  markAllRead: () => Promise<void>;
  /** Exposed so a screen that displays the list can resync after acting on it. */
  refreshUnread: () => Promise<void>;
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

  /* The signed-in user, mirrored so the reconnect and visibility handlers can
     recount without each one re-awaiting `getSession()`. */
  const userIdRef = useRef<string | null>(null);

  const refreshUnread = useCallback(async () => {
    const userId = userIdRef.current;
    if (!userId) return;

    const { count, error } = await supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("is_read", false);

    /* A failed recount leaves the previous number alone. Zeroing it on a network
       error would clear a badge that is still correct. */
    if (error) return;
    setUnreadCount(count || 0);
  }, []);

  useEffect(() => {
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let active = true;

    function subscribe(userId: string) {
      if (channel) supabase.removeChannel(channel);

      channel = supabase
        .channel(`notifications-${userId}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "notifications",
            filter: `user_id=eq.${userId}`,
          },
          (payload) => {
            const record = payload.new as { title: string; body: string | null; type: string };
            setUnreadCount((current) => current + 1);
            showToast(record.title || "New notification", { variant: "info" });
          }
        )
        .subscribe((status) => {
          /* Every (re)subscription recounts. On the first one this is the initial
             load; on a recovery it closes the gap the socket was down for. */
          if (status === "SUBSCRIBED" && active) void refreshUnread();
        });
    }

    async function init() {
      const { data } = await supabase.auth.getSession();
      if (!active) return;

      const userId = data.session?.user?.id ?? null;
      userIdRef.current = userId;
      if (!userId) return;

      subscribe(userId);
    }

    void init();

    /* Reconnect. Supabase's socket reconnects itself, but the rows it missed are
       gone — hence an explicit recount rather than relying on the channel. */
    const stopWatchingNetwork = subscribeToConnectivity((online) => {
      if (!online || !active) return;
      const userId = userIdRef.current;
      if (!userId) return;
      subscribe(userId);
      void refreshUnread();
    });

    /* Android reaps a backgrounded WebView's sockets, so coming back to the app
       is the same situation as coming back online. */
    function onVisible() {
      if (document.visibilityState !== "visible" || !active) return;
      void refreshUnread();
    }
    document.addEventListener("visibilitychange", onVisible);

    /* Sign-in and sign-out both have to move the count, or a badge from the
       previous account survives the switch. */
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      const nextId = session?.user?.id ?? null;
      if (nextId === userIdRef.current) return;

      userIdRef.current = nextId;
      setUnreadCount(0);

      if (nextId) {
        subscribe(nextId);
      } else if (channel) {
        supabase.removeChannel(channel);
        channel = null;
      }
    });

    return () => {
      active = false;
      stopWatchingNetwork();
      document.removeEventListener("visibilitychange", onVisible);
      listener.subscription.unsubscribe();
      if (channel) supabase.removeChannel(channel);
    };
  }, [showToast, refreshUnread]);

  const markAllRead = useCallback(async () => {
    const userId = userIdRef.current;
    if (!userId) return;

    await supabase
      .from("notifications")
      .update({ is_read: true })
      .eq("user_id", userId)
      .eq("is_read", false);
    setUnreadCount(0);
  }, []);

  return (
    <NotificationContext.Provider value={{ unreadCount, markAllRead, refreshUnread }}>
      {children}
    </NotificationContext.Provider>
  );
}
