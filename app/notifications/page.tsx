"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { notificationManager } from "@/lib/realtime/notifications";
import BottomNavigation from "@/components/BottomNavigation";
import BackButton from "@/components/BackButton";
import ShareMessageCard from "@/components/ShareMessageCard";
import GlassPanel from "@/components/GlassPanel";
import { Heart } from "lucide-react";

type Notification = {
  id: string;
  message: string;
  created_at: string;
};

export default function NotificationsPage() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewing, setViewing] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    async function init() {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        setLoading(false);
        return;
      }

      const { data } = await supabase
        .from("messages")
        .select("id,message,created_at")
        .eq("recipient_id", session.user.id)
        .order("created_at", { ascending: false });

      if (mounted) {
        setNotifications(data ?? []);
        setLoading(false);
      }

      notificationManager.connect(session.user.id, async () => {
        const { data } = await supabase
          .from("messages")
          .select("id,message,created_at")
          .eq("recipient_id", session.user.id)
          .order("created_at", { ascending: false });

        if (mounted) {
          setNotifications(data ?? []);
        }
      });
    }

    init();

    return () => {
      mounted = false;
      notificationManager.disconnect();
    };
  }, []);

  return (
    <main className="min-h-screen bg-[#090014] pb-28 text-white">
      <div className="p-6">
        <BackButton />

        <h1 className="mt-4 text-4xl font-black">
          🔔 Notifications
        </h1>

        {loading ? (
          <p className="mt-8 text-gray-400">Loading...</p>
        ) : notifications.length === 0 ? (
          <GlassPanel className="mt-8 rounded-3xl p-8 text-center">
            <h2 className="text-xl font-bold">No notifications yet</h2>
            <p className="mt-2 text-gray-400">
              You'll see new anonymous messages here.
            </p>
          </GlassPanel>
        ) : (
          <div className="mt-8 space-y-3">
            {notifications.map((item) => (
              <button
                key={item.id}
                onClick={() => setViewing(item.message)}
                className="w-full text-left"
              >
                <GlassPanel className="flex items-center gap-4 rounded-2xl p-4 hover:bg-white/10 transition">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-pink-500 to-red-500">
                    <Heart size={20} className="fill-white text-white" />
                  </div>

                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-pink-300">
                      New Message!
                    </p>

                    <p className="truncate text-sm text-gray-400">
                      {item.message}
                    </p>
                  </div>

                  <span className="text-xs text-gray-500">
                    {new Date(item.created_at).toLocaleDateString()}
                  </span>
                </GlassPanel>
              </button>
            ))}
          </div>
        )}
      </div>

      {viewing && (
        <ShareMessageCard
          message={viewing}
          onClose={() => setViewing(null)}
        />
      )}

      <BottomNavigation />
    </main>
  );
}