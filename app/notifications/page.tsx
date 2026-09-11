"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { safeErrorMessage } from "@/lib/safeErrorMessage";
import BottomNavigation from "@/components/BottomNavigation";
import BackButton from "@/components/BackButton";
import { refreshUnreadWhispers } from "@/lib/nav/navBadges";
import ShareMessageCard from "@/components/ShareMessageCard";
import NotificationActivityList from "@/components/NotificationActivityList";
import ConfirmDialog from "@/components/ConfirmDialog";
import GlassPanel from "@/components/GlassPanel";
import { HINT_UNLOCK_COST } from "@/lib/coins";
import { useToast } from "@/components/ToastProvider";
import { HAPTIC, vibrate } from "@/lib/haptics";
import { Heart, Download, Trash2, Lightbulb, LockKeyhole, Loader2, ChevronDown, Check, X } from "lucide-react";

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

/**
 * How long a press has to stay down before it becomes a selection, matching
 * the chat list's row menu (components/inbox/ChatRow.tsx) — one press-and-hold
 * vocabulary for the whole app, not a different number per screen.
 */
const LONG_PRESS_MS = 420;

export default function NotificationsPage() {
  const { showToast } = useToast();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  /* A failed fetch must never read as "no whispers": the empty state is only
     true when the query succeeds and returns zero rows. */
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [viewing, setViewing] = useState<{ message: string; imageUrl: string | null } | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  /* Delete is one flow for one row and for twenty: the pending list is what the
     confirmation is about, so a long-press selection and the row's own bin
     button land on the same dialog and the same request. */
  const [pendingDelete, setPendingDelete] = useState<Notification[] | null>(null);
  /* Multi-select. A press-and-hold is the way in (and the only way in: an
     inbox where a plain tap can start selecting is an inbox where a tap meant
     to open a whisper instead starts deleting things). */
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressed = useRef(false);
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
        setLoadError(safeErrorMessage(error, "Couldn't load your whispers."));
      } else {
        setLoadError(null);
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
    /* `reloadToken` is the retry button's handle: bumping it re-runs the whole
       load (session, query, unlocks, realtime) from a clean slate. */
  }, [reloadToken]);

  /* ------------------------------------------------------------------ */
  /* Selection                                                            */
  /* ------------------------------------------------------------------ */

  const cancelPress = useCallback(() => {
    if (pressTimer.current) {
      clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  }, []);

  /** A held press on a whisper enters selection mode with that row ticked. */
  function startPress(id: string, event: React.PointerEvent<HTMLDivElement>) {
    if (selectionMode) return;
    /* The card's own controls (bin, hint, save image) keep their own press
       meanings — holding the bin must not start selecting the row it deletes. */
    if ((event.target as HTMLElement).closest("[data-no-longpress]")) return;
    longPressed.current = false;
    cancelPress();
    pressTimer.current = setTimeout(() => {
      longPressed.current = true;
      vibrate(HAPTIC.select);
      setSelectionMode(true);
      setSelectedIds(new Set([id]));
    }, LONG_PRESS_MS);
  }

  function handleRowTap(item: Notification) {
    /* The pointerup that ended a successful hold also fires a click; without
       this the row would be selected and immediately opened. */
    if (longPressed.current) {
      longPressed.current = false;
      return;
    }
    if (selectionMode) {
      toggleSelected(item.id);
      return;
    }
    void openNotification(item);
  }

  function toggleSelected(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    vibrate(HAPTIC.tap);
  }

  function selectAll() {
    setSelectedIds(new Set(notifications.map((item) => item.id)));
    vibrate(HAPTIC.select);
  }

  /** Drop every tick but stay in selection mode — "Clear all" is not "leave". */
  function clearSelected() {
    setSelectedIds(new Set());
    vibrate(HAPTIC.tap);
  }

  function exitSelection() {
    setSelectionMode(false);
    setSelectedIds(new Set());
  }

  const allSelected = notifications.length > 0 && selectedIds.size === notifications.length;

  /* Escape is the universal "back out of this mode" key, and the selection bar
     is a mode. Only bound while it is on, so the key keeps its other meanings
     on this page the rest of the time. */
  useEffect(() => {
    if (!selectionMode) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setSelectionMode(false);
        setSelectedIds(new Set());
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectionMode]);

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
      showToast(safeErrorMessage(error));
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
      return;
    }

    /* Keep the bottom-nav unread dot in step with what the user has actually
       seen: the dot is a count of unread rows, and this page just read one. */
    void refreshUnreadWhispers();
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
    if (!pendingDelete || pendingDelete.length === 0) return;
    const items = pendingDelete;

    setDeleting(true);

    /* Complete delete on the server: the route destroys the Cloudinary images
       (or the legacy bucket objects) AND removes the database rows in one
       authorized call, so a failure in one half can't leave an orphaned asset
       or a row pointing at nothing. One request for the whole selection — a
       "select all" on a phone is dozens of rows, and dozens of authenticated
       round trips is how a bulk delete turns into a spinner that half-fails. */
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
          body: JSON.stringify(
            items.length === 1 ? { messageId: items[0].id } : { messageIds: items.map((item) => item.id) }
          ),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          console.error("Couldn't delete messages:", data.error);
          failed = true;
        }
      } catch (err) {
        console.error("Couldn't delete messages:", err);
        failed = true;
      }
    } else {
      failed = true;
    }

    setDeleting(false);

    if (failed) {
      showToast("Couldn't delete those whispers. Check your connection and try again.");
      return;
    }

    const removed = new Set(items.map((item) => item.id));
    setPendingDelete(null);
    setNotifications((prev) => prev.filter((item) => !removed.has(item.id)));
    /* The selection was chosen from rows that no longer exist. */
    exitSelection();
    /* A deleted unread whisper is no longer something to be read. */
    void refreshUnreadWhispers();
    vibrate(HAPTIC.warning);
    showToast(items.length > 1 ? `${items.length} whispers deleted.` : "Whisper deleted.", { variant: "subtle" });
  }

  return (
    <main className="min-h-screen theme-bg-gradient pb-28 text-white">
      <div className="p-6">
        <BackButton />

        {selectionMode ? (
          /* The selection bar takes the heading's place: what the screen is
             about right now is the selection, and the count is the one fact
             that matters. Select all / Clear sits next to the count because
             that is the gesture's second half ("a select all feature then
             delete"), and the bin is disabled at zero so it can never be
             pressed into a no-op dialog. */
          <div className="mt-4 flex items-center gap-2" role="toolbar" aria-label="Whisper selection">
            <button
              type="button"
              onClick={exitSelection}
              className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white/5 text-gray-200 transition hover:bg-white/10 active:scale-95"
              aria-label="Cancel selection"
            >
              <X size={18} />
            </button>
            <p className="min-w-0 flex-1 truncate text-lg font-black" aria-live="polite">
              {selectedIds.size} selected
            </p>
            <button
              type="button"
              onClick={allSelected ? clearSelected : selectAll}
              className="shrink-0 rounded-full bg-white/10 px-3.5 py-2 text-xs font-black text-cyan-100 transition hover:bg-white/15 active:scale-95"
            >
              {allSelected ? "Clear all" : "Select all"}
            </button>
            <button
              type="button"
              onClick={() => setPendingDelete(notifications.filter((item) => selectedIds.has(item.id)))}
              disabled={selectedIds.size === 0 || deleting}
              className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-red-500/20 text-red-300 transition hover:bg-red-500/30 active:scale-95 disabled:opacity-40"
              aria-label={`Delete ${selectedIds.size} selected whisper${selectedIds.size === 1 ? "" : "s"}`}
            >
              <Trash2 size={18} />
            </button>
          </div>
        ) : (
          <>
            <h1 className="page-title mt-4">📡 Activity</h1>
            {notifications.length > 0 && (
              <p className="mt-1 text-xs text-gray-400">
                Press and hold a whisper to select several, then delete them together.
              </p>
            )}
          </>
        )}

        {/* Everything the server told you — replies, transfers, calls, friend
            events — persistent and deep-linked. The whispers below are the
            anonymous inbox; this is the rest of the story. */}
        <NotificationActivityList />

        {loading ? (
          <p className="mt-8 text-gray-400">Loading...</p>
        ) : loadError && notifications.length === 0 ? (
          <GlassPanel className="mt-8 rounded-3xl p-8 text-center">
            <h2 className="text-xl font-bold">Couldn&apos;t load your whispers</h2>
            <p className="mt-2 text-sm text-gray-400">
              {loadError} Check your connection and try again — your messages are safe.
            </p>
            <button
              type="button"
              onClick={() => {
                setLoadError(null);
                setLoading(true);
                setReloadToken((token) => token + 1);
              }}
              className="mt-5 w-full rounded-2xl bg-gradient-to-r from-purple-600 to-fuchsia-500 py-3.5 font-bold text-white shadow-lg shadow-fuchsia-500/20 transition active:scale-[0.98] hover:opacity-95"
            >
              Try again
            </button>
          </GlassPanel>
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

              const selected = selectedIds.has(item.id);

              return (
                <GlassPanel
                  key={item.id}
                  onPointerDown={(event) => startPress(item.id, event)}
                  onPointerUp={cancelPress}
                  onPointerLeave={cancelPress}
                  onPointerCancel={cancelPress}
                  onContextMenu={(event) => {
                    /* Desktop: right-click selects, matching the row menu in
                       the chat list. The native menu is always suppressed —
                       on Android a long press without this summons the text
                       selection handles on top of the selection UI. */
                    event.preventDefault();
                    if (selectionMode || (event.target as HTMLElement).closest("[data-no-longpress]")) return;
                    vibrate(HAPTIC.select);
                    setSelectionMode(true);
                    setSelectedIds(new Set([item.id]));
                  }}
                  className={`select-none rounded-2xl p-4 transition-all duration-300 ${
                    selected
                      ? "bg-emerald-400/10 ring-2 ring-emerald-400/40"
                      : unread
                        ? "bg-white/5 ring-1 ring-white/10 shadow-lg shadow-black/20"
                        : "bg-white/[0.03] opacity-60"
                  }`}
                >
                  <div className="flex w-full items-center gap-4">
                    {selectionMode && (
                      <span
                        aria-hidden
                        className={`grid h-6 w-6 shrink-0 place-items-center rounded-full border transition ${
                          selected
                            ? "border-emerald-300 bg-emerald-400 text-black"
                            : "border-white/30 text-transparent"
                        }`}
                      >
                        <Check size={14} strokeWidth={3.5} />
                      </span>
                    )}
                    <button
                      onClick={() => handleRowTap(item)}
                      aria-pressed={selectionMode ? selected : undefined}
                      aria-label={selectionMode ? `Select whisper from ${new Date(item.created_at).toLocaleDateString()}` : undefined}
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

                    {!selectionMode && (
                      <button
                        data-no-longpress
                        onClick={() => setPendingDelete([item])}
                        disabled={deleting}
                        className="shrink-0 flex h-9 w-9 items-center justify-center rounded-full bg-white/5 text-gray-400 transition hover:bg-red-500/20 hover:text-red-400 disabled:opacity-50"
                        aria-label="Delete message"
                      >
                        <Trash2 size={16} />
                      </button>
                    )}
                  </div>

                  {item.image_url && (
                    <div className="relative mt-3">
                      <img
                        src={item.image_url}
                        alt="Anonymous attachment"
                        className="w-full max-h-72 rounded-2xl object-cover"
                      />
                      <button
                        data-no-longpress
                        onClick={() => downloadImage(item.image_url!, item.id)}
                        disabled={downloading === item.id}
                        className="absolute top-2 right-2 flex items-center gap-1.5 rounded-full bg-black/70 backdrop-blur-md px-3 py-2 text-xs font-semibold text-white hover:bg-black/90 transition disabled:opacity-60"
                      >
                        <Download size={14} />
                        {downloading === item.id ? "Saving..." : "Save"}
                      </button>
                    </div>
                  )}

                  <div className={`mt-3 ${selectionMode ? "pointer-events-none opacity-40" : ""}`}>
                    <button
                      data-no-longpress
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

      {pendingDelete && pendingDelete.length > 0 && (
        <ConfirmDialog
          title={pendingDelete.length > 1 ? `Delete ${pendingDelete.length} whispers?` : "Delete this whisper?"}
          description={
            pendingDelete.length > 1
              ? "This can't be undone. Every selected whisper and its attached image will be permanently removed."
              : "This can't be undone. The whisper and any attached image will be permanently removed."
          }
          onConfirm={confirmDelete}
          onCancel={() => setPendingDelete(null)}
          loading={deleting}
        />
      )}

      <BottomNavigation />
    </main>
  );
}