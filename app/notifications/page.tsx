"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import BottomNavigation from "@/components/BottomNavigation";
import BackButton from "@/components/BackButton";
import ShareMessageCard from "@/components/ShareMessageCard";
import GlassPanel from "@/components/GlassPanel";
import { Heart, Download } from "lucide-react";

type Notification = {
  id: string;
  message: string;
  image_url: string | null;
  created_at: string;
};

export default function NotificationsPage() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewing, setViewing] = useState<{ message: string; imageUrl: string | null } | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);

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
        .select("id,message,image_url,created_at")
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
            setNotifications((prev) => [payload.new as Notification, ...prev]);
          }
        )
        .subscribe();
    }

    init();

    return () => {
      if (channel) supabase.removeChannel(channel);
    };
  }, []);

  async function downloadImage(url: string, id: string) {
    setDownloading(id);
    try {
      const response = await fetch(url);
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = blobUrl;
      link.download = `whisper-image-${id}.jpg`;
      link.click();
      URL.revokeObjectURL(blobUrl);
    } catch (err) {
      console.error("Download failed", err);
    } finally {
      setDownloading(null);
    }
  }

  return (
    <main className="min-h-screen theme-bg-gradient pb-28 text-white">
      <div className="p-6">
        <BackButton />
        <h1 className="mt-4 text-4xl font-black">📡 Activity</h1>

        {loading ? (
          <p className="mt-8 text-gray-400">Loading...</p>
        ) : notifications.length === 0 ? (
          <GlassPanel className="mt-8 rounded-3xl p-8 text-center">
            <h2 className="text-xl font-bold">No notifications yet</h2>
            <p className="mt-2 text-gray-400">
              You&apos;ll see new anonymous messages here.
            </p>
          </GlassPanel>
        ) : (
          <div className="mt-8 space-y-3">
            {notifications.map((item) => (
              <GlassPanel key={item.id} className="rounded-2xl p-4">
                <button
                  onClick={() =>
                    setViewing({ message: item.message || "", imageUrl: item.image_url })
                  }
                  className="flex w-full items-center gap-4 text-left"
                >
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-pink-500 to-red-500">
                    <Heart size={20} className="fill-white text-white" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-pink-300">New Message!</p>
                    {item.message && (
                      <p className="truncate text-sm text-gray-400">{item.message}</p>
                    )}
                    {!item.message && item.image_url && (
                      <p className="truncate text-sm text-gray-400">📷 Image</p>
                    )}
                  </div>
                  <span className="shrink-0 text-xs text-gray-500">
                    {new Date(item.created_at).toLocaleDateString()}
                  </span>
                </button>

                {item.image_url && (
                  <div className="relative mt-3">
                    <img
                      src={item.image_url}
                      alt="Anonymous attachment"
                      className="w-full max-h-72 rounded-2xl object-cover"
                    />
                    <button
                      onClick={() => downloadImage(item.image_url!, item.id)}
                      disabled={downloading === item.id}
                      className="absolute top-2 right-2 flex items-center gap-1.5 rounded-full bg-black/70 backdrop-blur-md px-3 py-2 text-xs font-semibold text-white hover:bg-black/90 transition disabled:opacity-60"
                    >
                      <Download size={14} />
                      {downloading === item.id ? "Saving..." : "Save"}
                    </button>
                  </div>
                )}
              </GlassPanel>
            ))}
          </div>
        )}
      </div>

      {viewing && (
        <ShareMessageCard
          message={viewing.message}
          imageUrl={viewing.imageUrl}
          onClose={() => setViewing(null)}
        />
      )}

      <BottomNavigation />
    </main>
  );
}