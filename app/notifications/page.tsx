"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import BottomNavigation from "@/components/BottomNavigation";
import BackButton from "@/components/BackButton";
import ShareMessageCard from "@/components/ShareMessageCard";
import ConfirmDialog from "@/components/ConfirmDialog";
import GlassPanel from "@/components/GlassPanel";
import { HINT_UNLOCK_COST } from "@/lib/coins";
import { useToast } from "@/components/ToastProvider";
import { Heart, Download, Trash2, Lightbulb, LockKeyhole, Loader2, ChevronDown } from "lucide-react";

type Notification = {
  id: string;
  message: string;
  image_url: string | null;
  created_at: string;
  is_read: boolean;
  sender_username: string | null;
  sender_email_name: string | null;
};

type HintUnlock = { message_id: string };

export default function NotificationsPage() {
  const { showToast } = useToast();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewing, setViewing] = useState<{ message: string; imageUrl: string | null } | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Notification | null>(null);
  const [hintUnlocks, setHintUnlocks] = useState<HintUnlock[]>([]);
  const [expandedHintId, setExpandedHintId] = useState<string | null>(null);
  const [unlockingHintId, setUnlockingHintId] = useState<string | null>(null);

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
        .select("id,message,image_url,created_at,is_read,sender_username,sender_email_name")
        .eq("recipient_id", session.user.id)
        .order("created_at", { ascending: false });

      if (!error) {
        setNotifications(data || []);
      }

      const { data: unlocks } = await supabase
        .from("anonymous_sender_reveals")
        .select("message_id")
        .eq("user_id", session.user.id);
      setHintUnlocks(unlocks || []);

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
            const incoming = payload.new as Notification;
            setNotifications((prev) =>
              prev.some((n) => n.id === incoming.id) ? prev : [incoming, ...prev]
            );
          }
        )
        .subscribe();
    }

    init();

    return () => {
      if (channel) supabase.removeChannel(channel);
    };
  }, []);

  function hintUnlocked(messageId: string) {
    return hintUnlocks.some((unlock) => unlock.message_id === messageId);
  }

  async function unlockHint(messageId: string) {
    if (hintUnlocked(messageId)) return;

    setUnlockingHintId(messageId);
    const { data, error } = await supabase.rpc("unlock_hint_with_coins", { target_message_id: messageId });

    if (error) {
      showToast(error.message);
    } else {
      setHintUnlocks((prev) =>
        prev.some((unlock) => unlock.message_id === messageId)
          ? prev
          : [...prev, { message_id: messageId }]
      );
      showToast(`Hint unlocked. Balance: ${data ?? 0} coins`);
    }

    setUnlockingHintId(null);
  }

  function hintContent(item: Notification) {
    return (
      <div className="grid gap-2 rounded-2xl bg-emerald-400/10 p-3 text-sm text-emerald-50 ring-1 ring-emerald-300/20">
        <span>Username hint: <b>{item.sender_username || "Unknown"}</b></span>
        <span>Gmail name hint: <b>{item.sender_email_name || "Unavailable"}</b></span>
      </div>
    );
  }

  async function openNotification(item: Notification) {
    setViewing({ message: item.message || "", imageUrl: item.image_url });

    if (item.is_read) return;

    // Instant fade — flip the row locally right away, then persist it.
    setNotifications((prev) =>
      prev.map((n) => (n.id === item.id ? { ...n, is_read: true } : n))
    );

    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session) {
      setNotifications((prev) =>
        prev.map((n) => (n.id === item.id ? { ...n, is_read: false } : n))
      );
      return;
    }

    const { error } = await supabase
      .from("messages")
      .update({ is_read: true })
      .eq("id", item.id)
      .eq("recipient_id", session.user.id);

    if (error) {
      console.error("Failed to mark notification as read:", error.message);
      // Revert on failure so the dot/fade stays accurate.
      setNotifications((prev) =>
        prev.map((n) => (n.id === item.id ? { ...n, is_read: false } : n))
      );
    }
  }

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

  function extractStoragePath(imageUrl: string): string | null {
    const marker = "/message-images/";
    const idx = imageUrl.indexOf(marker);
    if (idx === -1) return null;
    return imageUrl.slice(idx + marker.length);
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    const item = pendingDelete;

    setDeleting(item.id);

    if (item.image_url) {
      const path = extractStoragePath(item.image_url);
      if (path) {
        const { error: storageError } = await supabase.storage
          .from("message-images")
          .remove([path]);
        if (storageError) {
          console.error("Failed to remove image from storage:", storageError.message);
        }
      }
    }

    const { error } = await supabase.from("messages").delete().eq("id", item.id);

    setDeleting(null);
    setPendingDelete(null);

    if (error) {
      console.error("Couldn't delete message:", error.message);
      return;
    }

    setNotifications((prev) => prev.filter((n) => n.id !== item.id));
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
            {notifications.map((item) => {
              const unread = !item.is_read;

              return (
                <GlassPanel
                  key={item.id}
                  className={`rounded-2xl p-4 transition-all duration-300 ${
                    unread
                      ? "bg-white/5 ring-1 ring-white/10 shadow-lg shadow-black/20"
                      : "bg-white/[0.03] opacity-60"
                  }`}
                >
                  <div className="flex w-full items-center gap-4">
                    <button
                      onClick={() => openNotification(item)}
                      className="flex min-w-0 flex-1 items-center gap-4 text-left"
                    >
                      <div className={`relative flex h-12 w-12 shrink-0 items-center justify-center rounded-full ${unread ? "bg-gradient-to-br from-pink-500 to-red-500" : "bg-gradient-to-br from-pink-500/45 to-red-500/45"}`}>
                        <Heart size={20} className={`fill-white text-white ${unread ? "" : "opacity-60"}`} />
                        {unread && (
                          <span className="absolute -top-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-2 border-black/40 bg-rose-500 shadow-lg shadow-rose-500/40" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className={`font-semibold ${unread ? "text-white" : "text-gray-300"}`}>
                          New Message!
                        </p>
                        {item.message && (
                          <p className={`truncate text-sm ${unread ? "text-gray-100" : "text-gray-500"}`}>{item.message}</p>
                        )}
                        {!item.message && item.image_url && (
                          <p className={`truncate text-sm ${unread ? "text-gray-100" : "text-gray-500"}`}>📷 Image</p>
                        )}
                      </div>
                    </button>

                    <span className={`shrink-0 text-xs ${unread ? "text-gray-300" : "text-gray-500/80"}`}>
                      {new Date(item.created_at).toLocaleDateString()}
                    </span>

                    <button
                      onClick={() => setPendingDelete(item)}
                      disabled={deleting === item.id}
                      className="shrink-0 flex h-9 w-9 items-center justify-center rounded-full bg-white/5 text-gray-400 transition hover:bg-red-500/20 hover:text-red-400 disabled:opacity-50"
                      aria-label="Delete message"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>

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

                  <div className="mt-3">
                    <button
                      onClick={() => setExpandedHintId((current) => (current === item.id ? null : item.id))}
                      className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-2 text-xs font-black text-cyan-100 transition hover:bg-white/15 active:scale-95"
                    >
                      <Lightbulb size={14} className="text-yellow-200" />
                      Hint
                      <ChevronDown
                        size={14}
                        className={`transition-transform duration-300 ${expandedHintId === item.id ? "rotate-180" : ""}`}
                      />
                    </button>

                    <div
                      className={`grid transition-[grid-template-rows,opacity] duration-300 ease-out ${
                        expandedHintId === item.id ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
                      }`}
                    >
                      <div className="overflow-hidden">
                        <div className="mt-3 rounded-2xl border border-white/10 bg-black/20 p-4">
                          {hintUnlocked(item.id) ? (
                            hintContent(item)
                          ) : (
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                              <div>
                                <p className="text-sm font-black text-white">Unlock hint for {HINT_UNLOCK_COST} coins</p>
                                <p className="mt-1 text-xs text-gray-400">Shows the sender username and Gmail name hint for this whisper.</p>
                              </div>
                              <button
                                onClick={() => unlockHint(item.id)}
                                disabled={unlockingHintId === item.id}
                                className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-cyan-300 to-pink-300 px-4 py-2 text-sm font-black text-black transition active:scale-95 disabled:opacity-60"
                              >
                                {unlockingHintId === item.id ? <Loader2 size={16} className="animate-spin" /> : <LockKeyhole size={16} />}
                                {unlockingHintId === item.id ? "Unlocking..." : "Unlock"}
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </GlassPanel>
              );
            })}
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

      {pendingDelete && (
        <ConfirmDialog
          title="Delete this message?"
          description="This can't be undone. The message and any attached image will be permanently removed."
          onConfirm={confirmDelete}
          onCancel={() => setPendingDelete(null)}
          loading={deleting === pendingDelete.id}
        />
      )}

      <BottomNavigation />
    </main>
  );
}