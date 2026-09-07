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
};

/**
 * The paid Hint, fetched only for messages this user has actually unlocked.
 *
 * The first fetch no longer selects the sender_* columns at all: the hint used
 * to be paid only at render time — every row's location/device shipped to the
 * browser up front and the unlock flag merely decided whether to draw it, so a
 * devtools peek (or a direct PostgREST call) got it for free. It is now read
 * through `whisper_hints_for`, a definer RPC that refuses any message without a
 * matching row in `anonymous_sender_reveals`.
 */
type WhisperHint = {
  message_id: string;
  sender_country: string | null;
  sender_state: string | null;
  sender_city: string | null;
  sender_device: string | null;
  sent_at: string | null;
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
  const [hints, setHints] = useState<WhisperHint[]>([]);
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
        .select("id,message,image_url,created_at,is_read")
        .eq("recipient_id", session.user.id)
        .order("created_at", { ascending: false });

      if (error) {
        console.error("Fetch error:", error);
      } else {
        setNotifications(data || []);
      }

      const { data: unlocks } = await supabase
        .from("anonymous_sender_reveals")
        .select("message_id")
        .eq("user_id", session.user.id);
      setHintUnlocks(unlocks || []);

      /* The hints for messages already paid for, fetched lazily by id: the
         columns are unreadable from the browser now (202609070001 revokes them
         on `messages`), and this RPC answers only rows with an unlock receipt. */
      const unlockedIds = (unlocks || []).map((u) => u.message_id);
      if (unlockedIds.length > 0) {
        const { data: hintRows } = await supabase.rpc("whisper_hints_for", {
          p_message_ids: unlockedIds,
        });
        setHints(
          (hintRows as WhisperHint[] | null) || []
        );
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

  /**
   * The reveal is shown only when the (paid) hint data is actually in hand.
   *
   * An unlock flag without a matching hint row means the data was revoked at
   * the column layer but not fetched through the new RPC — a mid-deploy or a
   * legacy row — and re-reading it is free (no second charge), so the unlock
   * path above repopulates it. If it is still missing we fall through to the
   * unlock button, which short-circuits on `hintUnlocked` and just re-reads.
   */
  function hintFor(messageId: string): WhisperHint | undefined {
    return hints.find((hint) => hint.message_id === messageId);
  }

  async function unlockHint(messageId: string) {
    if (hintUnlocked(messageId)) {
      /* Already paid but the data is not in hand (page loaded before the hint
         fetch, or a legacy unlock). Re-read is free — no second charge — so
         fetch and render instead of silently doing nothing. */
      const { data: retryRows } = await supabase.rpc("whisper_hints_for", {
        p_message_ids: [messageId],
      });
      const rows = (retryRows as WhisperHint[] | null) || [];
      if (rows.length > 0) {
        setHints((prev) => [...prev.filter((h) => h.message_id !== messageId), ...rows]);
      }
      return;
    }

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
      /* Balance changes are the definition of a low-priority notification: the
         wallet UI already reflects the new figure, and this fires on an action the
         user just chose to take. */
      showToast("Hint unlocked", { variant: "subtle" });

      /* The paid reveal itself: the columns only come back from the definer
         RPC once the receipt exists server-side, which it does now — this is a
         read, not another charge. */
      const { data: hintRows } = await supabase.rpc("whisper_hints_for", {
        p_message_ids: [messageId],
      });
      const rows = (hintRows as WhisperHint[] | null) || [];
      if (rows.length > 0) {
        setHints((prev) => [...prev.filter((h) => h.message_id !== messageId), ...rows]);
      }
    }

    setUnlockingHintId(null);
  }

  function hintContent(item: Notification, hint: WhisperHint) {
    /* Prefer the message's own timestamp (always present, matches the row the
       reader is looking at); sent_at is a cross-check the RPC also carries. */
    const timeStr = new Date(hint.sent_at || item.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const location = [hint.sender_city, hint.sender_state, hint.sender_country].filter(Boolean).join(", ");
    const senderParts = (hint.sender_device || "Unknown Device • Unknown Browser")
      .split("•")
      .map((part) => part.trim())
      .filter(Boolean);
    const deviceType = senderParts[0] || "Unknown Device";
    const browserName = senderParts[1] || "Unknown Browser";

    return (
      <div className="grid gap-2 rounded-2xl bg-emerald-400/10 p-3 text-sm text-emerald-50 ring-1 ring-emerald-300/20">
        <div className="flex justify-between border-b border-emerald-400/10 pb-1">
          <span className="opacity-70">Location:</span>
          <span className="font-bold">{location || "Unknown"}</span>
        </div>
        <div className="flex justify-between border-b border-emerald-400/10 pb-1">
          <span className="opacity-70">Time sent:</span>
          <span className="font-bold">{timeStr}</span>
        </div>
        <div className="flex justify-between border-b border-emerald-400/10 pb-1">
          <span className="opacity-70">Device:</span>
          <span className="font-bold">{deviceType}</span>
        </div>
        <div className="flex justify-between">
          <span className="opacity-70">Browser:</span>
          <span className="font-bold">{browserName}</span>
        </div>
      </div>
    );
  }

  async function openNotification(item: Notification) {
    setViewing({ message: item.message || "", imageUrl: item.image_url });

    if (item.is_read) return;

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

  async function confirmDelete() {
    if (!pendingDelete) return;
    const item = pendingDelete;

    setDeleting(item.id);

    /* Complete delete on the server: the route destroys the Cloudinary image
       (or the legacy bucket object) AND removes the database row in one
       authorized call, so a failure in one half can't leave an orphaned asset
       or a row pointing at nothing. */
    const {
      data: { session },
    } = await supabase.auth.getSession();

    let failed = false;
    if (session) {
      try {
        const res = await fetch("/api/messages/delete", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ messageId: item.id }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          console.error("Couldn't delete message:", data.error);
          failed = true;
        }
      } catch (err) {
        console.error("Couldn't delete message:", err);
        failed = true;
      }
    } else {
      failed = true;
    }

    setDeleting(null);
    setPendingDelete(null);

    if (!failed) {
      setNotifications((prev) => prev.filter((n) => n.id !== item.id));
    }
  }

  return (
    <main className="min-h-screen theme-bg-gradient pb-28 text-white">
      <div className="p-6">
        <BackButton />
        <h1 className="page-title mt-4">📡 Activity</h1>

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
                          {hintFor(item.id) ? (
                            hintContent(item, hintFor(item.id)!)
                          ) : (
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                              <div>
                                <p className="text-sm font-black text-white">
                                  {hintUnlocked(item.id)
                                    ? "Load unlocked hint"
                                    : `Unlock hint for ${HINT_UNLOCK_COST} coins`}
                                </p>
                                <p className="mt-1 text-xs text-gray-400">
                                  Reveals sender metadata like approximate location and time of whisper.
                                </p>
                              </div>
                              <button
                                onClick={() => unlockHint(item.id)}
                                disabled={unlockingHintId === item.id}
                                className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-purple-400 to-pink-300 px-4 py-2 text-sm font-black text-black transition active:scale-95 disabled:opacity-60"
                              >
                                {unlockingHintId === item.id ? <Loader2 size={16} className="animate-spin" /> : <LockKeyhole size={16} />}
                                {unlockingHintId === item.id
                                  ? "Loading..."
                                  : hintUnlocked(item.id)
                                    ? "Load"
                                    : "Unlock"}
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