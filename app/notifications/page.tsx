"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import BottomNavigation from "@/components/BottomNavigation";
import BackButton from "@/components/BackButton";

type Notification = {
  id: string;
  message: string;
  created_at: string;
};

export default function NotificationsPage() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let channel: ReturnType<typeof supabase.channel> | null = null;

    async function init() {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        setLoading(false);
        return;
      }

      const { data, error } = await supabase
        .from("messages")
        .select("id,message,created_at")
        .eq("recipient_id", session.user.id)
        .order("created_at", { ascending: false });

      if (!error) {
        setNotifications(data || []);
      }

      setLoading(false);

      channel = supabase
        .channel(`notifications-${session.user.id}-${Date.now()}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "messages",
            filter: `recipient_id=eq.${session.user.id}`,
          },
          (payload) => {
            setNotifications((prev) => [
              payload.new as Notification,
              ...prev,
            ]);
          }
        )
        .subscribe();
    }

    init();

    return () => {
      if (channel) {
        supabase.removeChannel(channel);
      }
    };
  }, []);

  return (
    <main className="min-h-screen bg-[#090014] pb-28 text-white">
      <div className="p-6">
        <BackButton />

        <h1 className="mt-6 text-4xl font-black">
          🔔 Notifications
        </h1>

        {loading ? (
          <p className="mt-8 text-gray-400">Loading...</p>
        ) : notifications.length === 0 ? (
          <div className="mt-8 rounded-3xl bg-white/5 p-8 text-center">
            <h2 className="text-xl font-bold">
              No notifications yet
            </h2>

            <p className="mt-2 text-gray-400">
              You'll see new anonymous messages here.
            </p>
          </div>
        ) : (
          <div className="mt-8 space-y-4">
            {notifications.map((item) => (
              <div
                key={item.id}
                className="rounded-3xl bg-white/5 p-5 border border-cyan-500/20"
              >
                <p className="font-semibold text-cyan-300">
                  📩 New Anonymous Message
                </p>

                <p className="mt-2 text-gray-300 break-words">
                  {item.message}
                </p>

                <p className="mt-3 text-xs text-gray-500">
                  {new Date(item.created_at).toLocaleString()}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      <BottomNavigation />
    </main>
  );
}