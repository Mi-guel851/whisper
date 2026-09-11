"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { useAnonNames } from "@/lib/anonNames";
import { generatedAvatarUrl } from "@/lib/generatedAvatar";
import IncomingCallOverlay from "./IncomingCallOverlay";

/**
 * The incoming-call ring, heard from anywhere in the app.
 *
 * The chat page already rings when its thread is open (live signaling via
 * `useVoiceCall`), but a call is not a chat-page event — the callee can be on
 * the dashboard, the feed, or arriving cold from a push tap. This listener is
 * mounted once in the root layout so the ring finds them wherever they are.
 *
 * SOURCE OF TRUTH
 *
 * `public.notifications` rows typed `call`, written by `start_call_log` for
 * the callee with `{ conversation_id, caller_id, call_id, route }` metadata.
 * Three paths converge on the same overlay:
 *
 *   realtime INSERT  the app is open: the row lands and the overlay appears.
 *   cold-start query unread `call` rows younger than the ring window, so a
 *                        user who opens the app mid-ring still sees it.
 *   push tap           the native tap handler stashes the payload (see
 *                        `PENDING_CALL_KEY`) and dispatches
 *                        `whisper:incoming-call`; this picks it up even before
 *                        the realtime socket has subscribed.
 *
 * PRECEDENCE
 *
 * When the user is already on that conversation's chat page this stays silent:
 * the page renders its own overlay from live signaling, which is the one that
 * can actually answer (the SDP offer only exists on that channel). Accepting
 * here therefore navigates to the chat — the deep link IS the accept path —
 * and declining finalizes the row via `end_call_log` so the caller stops
 * ringing and the device banner is retired server-side.
 *
 * EXPIRY
 *
 * A ring lives 60 seconds server-side (`expire_stale_calls`). The overlay
 * carries its own timer for the same window, and also dismisses the moment
 * the row is marked read or deleted (answered elsewhere, declined elsewhere,
 * caller hung up).
 */

export const INCOMING_CALL_EVENT = "whisper:incoming-call";
export const PENDING_CALL_KEY = "whisper:pending-call";

/** How long a ring is showable, matching the server's 60s ring window. */
const RING_WINDOW_MS = 60_000;

type CallAlert = {
  /** The notifications row id, if this alert came from one. */
  id: string | null;
  conversationId: string;
  callerId: string;
  callId: string | null;
  createdAt: number;
};

type CallNotificationRow = {
  id: string;
  created_at: string;
  is_read: boolean;
  metadata: {
    conversation_id?: string;
    conversationId?: string;
    caller_id?: string;
    call_id?: string;
    callId?: string;
  } | null;
};

function alertFromRow(row: CallNotificationRow): CallAlert | null {
  const conversationId = row.metadata?.conversation_id ?? row.metadata?.conversationId;
  const callerId = row.metadata?.caller_id;
  if (!conversationId || !callerId) return null;
  return {
    id: row.id,
    conversationId,
    callerId,
    callId: row.metadata?.call_id ?? row.metadata?.callId ?? null,
    createdAt: new Date(row.created_at).getTime(),
  };
}

function isFresh(alert: CallAlert): boolean {
  return Date.now() - alert.createdAt < RING_WINDOW_MS;
}

export default function GlobalCallListener() {
  const router = useRouter();
  const pathname = usePathname();
  const [alert, setAlert] = useState<CallAlert | null>(null);
  const userIdRef = useRef<string | null>(null);
  const alertRef = useRef<CallAlert | null>(null);
  const expiryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    alertRef.current = alert;
  }, [alert]);

  const callerIds = useMemo(() => (alert ? [alert.callerId] : []), [alert]);
  const nameOf = useAnonNames(callerIds);

  const clearExpiry = useCallback(() => {
    if (expiryTimer.current) {
      clearTimeout(expiryTimer.current);
      expiryTimer.current = null;
    }
  }, []);

  const dismiss = useCallback(() => {
    clearExpiry();
    setAlert(null);
    try {
      sessionStorage.removeItem(PENDING_CALL_KEY);
    } catch {
      /* Storage unavailable — the overlay state is what matters. */
    }
  }, [clearExpiry]);

  const show = useCallback(
    (next: CallAlert) => {
      if (!isFresh(next)) return;
      /* A newer ring replaces an older one; re-showing the same row (realtime
         replay after a resubscribe) must not restart anything. */
      const current = alertRef.current;
      if (current && current.id && current.id === next.id) return;
      if (current && current.createdAt > next.createdAt) return;
      clearExpiry();
      setAlert(next);
      const remaining = Math.max(0, RING_WINDOW_MS - (Date.now() - next.createdAt));
      expiryTimer.current = setTimeout(() => setAlert(null), remaining);
    },
    [clearExpiry]
  );

  /** The cold-start query: unread `call` rows still inside the ring window. */
  const loadPending = useCallback(async () => {
    const userId = userIdRef.current;
    if (!userId) return;
    const since = new Date(Date.now() - RING_WINDOW_MS).toISOString();
    const { data } = await supabase
      .from("notifications")
      .select("id,created_at,is_read,metadata")
      .eq("user_id", userId)
      .eq("type", "call")
      .eq("is_read", false)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(3);
    const rows = (data ?? []) as unknown as CallNotificationRow[];
    for (const row of rows) {
      const parsed = alertFromRow(row);
      if (parsed && isFresh(parsed)) {
        show(parsed);
        return;
      }
    }
  }, [show]);

  useEffect(() => {
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let active = true;

    function subscribe(userId: string) {
      if (channel) supabase.removeChannel(channel);
      channel = supabase
        .channel(`global-calls-${userId}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "notifications",
            filter: `user_id=eq.${userId}`,
          },
          (payload) => {
            const row = payload.new as unknown as CallNotificationRow & { type?: string };
            if (row.type !== "call") return;
            const parsed = alertFromRow(row);
            if (parsed) show(parsed);
          }
        )
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "notifications",
            filter: `user_id=eq.${userId}`,
          },
          (payload) => {
            /* Answered/declined/retired elsewhere: the row going read (or its
               call ending server-side) is this overlay's cue to stand down. */
            const row = payload.new as unknown as CallNotificationRow & { type?: string };
            const current = alertRef.current;
            if (!current?.id) return;
            if (row.id === current.id && (row.type !== "call" || row.is_read)) {
              setAlert(null);
            }
          }
        )
        .on(
          "postgres_changes",
          {
            event: "DELETE",
            schema: "public",
            table: "notifications",
            filter: `user_id=eq.${userId}`,
          },
          (payload) => {
            const row = payload.old as { id?: string };
            if (row.id && row.id === alertRef.current?.id) setAlert(null);
          }
        )
        .subscribe();
    }

    async function init() {
      const { data } = await supabase.auth.getSession();
      if (!active) return;
      const userId = data.session?.user?.id ?? null;
      userIdRef.current = userId;
      if (!userId) return;
      subscribe(userId);
      void loadPending();
    }

    void init();

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      const nextId = session?.user?.id ?? null;
      if (nextId === userIdRef.current) return;
      userIdRef.current = nextId;
      setAlert(null);
      if (nextId && active) {
        subscribe(nextId);
        void loadPending();
      } else if (channel) {
        supabase.removeChannel(channel);
        channel = null;
      }
    });

    /* A push tap for a call, delivered while the app is already open: show the
       overlay from the payload immediately, then reconcile against the row. */
    function onPushCall(event: Event) {
      const detail = (event as CustomEvent<{
        conversationId?: string;
        callerId?: string | null;
        callId?: string | null;
      }>).detail;
      if (!detail?.conversationId) return;
      if (detail.callerId) {
        show({
          id: null,
          conversationId: detail.conversationId,
          callerId: detail.callerId,
          callId: detail.callId ?? null,
          createdAt: Date.now(),
        });
      }
      /* Reconcile: the payload overlay carries no row id, so the row query
         swaps in the durable alert (with its id) the moment it answers. */
      void loadPending();
    }
    window.addEventListener(INCOMING_CALL_EVENT, onPushCall);

    /* A push tap that cold-started the app: the tap handler stashed the
       payload before the reload, and the reload is this mount. */
    try {
      const raw = sessionStorage.getItem(PENDING_CALL_KEY);
      if (raw) {
        const pending = JSON.parse(raw) as {
          conversationId?: string;
          callerId?: string | null;
          callId?: string | null;
          at?: number;
        };
        if (
          pending?.conversationId &&
          pending.callerId &&
          typeof pending.at === "number" &&
          Date.now() - pending.at < RING_WINDOW_MS
        ) {
          show({
            id: null,
            conversationId: pending.conversationId,
            callerId: pending.callerId,
            callId: pending.callId ?? null,
            createdAt: pending.at,
          });
        } else {
          sessionStorage.removeItem(PENDING_CALL_KEY);
        }
      }
    } catch {
      /* Corrupt stash — the row query below is the backstop. */
    }

    return () => {
      active = false;
      listener.subscription.unsubscribe();
      window.removeEventListener(INCOMING_CALL_EVENT, onPushCall);
      if (channel) supabase.removeChannel(channel);
      if (expiryTimer.current) clearTimeout(expiryTimer.current);
    };
  }, [loadPending, show]);

  const accept = useCallback(() => {
    if (!alert) return;
    const conversationId = alert.conversationId;
    dismiss();
    /* The chat screen IS the accept path: its signaling channel holds the
       live offer, so arriving there is what lets the call connect. */
    router.push(`/chat/${conversationId}`);
  }, [alert, dismiss, router]);

  const decline = useCallback(() => {
    const current = alertRef.current;
    dismiss();
    if (!current) return;
    void (async () => {
      try {
        /* Finalize the row so the caller stops ringing and every device
           banner is retired; then retire our own alert row. Either failing
           still leaves the server-side expiry to do the same within a minute. */
        if (current.callId) {
          await supabase.rpc("end_call_log", {
            p_call_id: current.callId,
            p_outcome: "declined",
          });
        }
        if (current.id) {
          await supabase.from("notifications").update({ is_read: true }).eq("id", current.id);
        }
      } catch {
        /* Best effort — the overlay is already gone, which is the promise. */
      }
    })();
  }, [dismiss]);

  /* The chat page owns its own ring: rendering this one on top of live
     signaling would stack two overlays for one call. */
  if (!alert || pathname === `/chat/${alert.conversationId}`) return null;

  return (
    <IncomingCallOverlay
      name={nameOf(alert.callerId) || "Anonymous Friend"}
      avatarUrl={generatedAvatarUrl(alert.callerId)}
      onAccept={accept}
      onDecline={decline}
    />
  );
}
