"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { AnimatePresence } from "framer-motion";

import { supabase } from "@/lib/supabase/client";
import { useToast } from "@/components/ToastProvider";
import { useAnonNames } from "@/lib/anonNames";
import { generatedAvatarUrl } from "@/lib/generatedAvatar";
import { callSession } from "@/lib/calls/callSession";
import { useCallSession } from "@/lib/calls/useCallSession";
import IncomingCallOverlay from "./IncomingCallOverlay";
import InCallSheet from "./InCallSheet";
import InCallPill from "./InCallPill";

/**
 * The call, owned by the app rather than by a page.
 *
 * Mounted once in the root layout, next to the other "not a route" providers.
 * Three jobs:
 *
 *   1. FINDS the ring. Three paths converge here: a realtime INSERT on
 *      `public.notifications` typed `call` (the app is open), a cold-start query
 *      of unread `call` rows still inside the 60s window (the user opened the app
 *      mid-ring), and a push tap — a live `whisper:incoming-call` event, or the
 *      `whisper:pending-call` stash left behind by a tap that cold-started the
 *      WebView. All three hand the same shape to `callSession`.
 *
 *   2. ENFORCES the overlay, on every route, with no exceptions. The old split —
 *      a global listener that stayed silent on the ringing conversation's chat
 *      page because that page rendered its own — existed only because two things
 *      owned one call. The engine is the single owner now, so there is exactly
 *      one overlay and it appears wherever the user is standing.
 *
 *   3. RENDERS the surfaces from the engine's state: the full-screen ring, the
 *      full-screen in-call sheet, or — the moment a call is answered or
 *      minimized — the pill at the top of the screen. Because this is in the root
 *      layout, the pill is still there after a navigation, and the call behind it
 *      is still live.
 *
 * EXPIRY
 *
 * A ring lives 60 seconds server-side (`expire_stale_calls`). The engine carries
 * its own timer for the same window, and stands the overlay down the moment the
 * row is marked read or deleted (answered elsewhere, declined elsewhere, caller
 * hung up).
 */

/** Dispatched by lib/push/useRegisterPushNotifications.ts on a call tap. */
export const INCOMING_CALL_EVENT = "whisper:incoming-call";
/** Where a tap that cold-started the app stashes its payload. */
export const PENDING_CALL_KEY = "whisper:pending-call";

/** How long a ring is showable, matching the server's 60s ring window. */
const RING_WINDOW_MS = 60_000;

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
    caller_name?: string;
    callerName?: string;
    caller_avatar?: string;
    callerAvatar?: string;
  } | null;
};

type Ring = {
  conversationId: string;
  callerId: string;
  callId: string | null;
  createdAt: number;
  callerName?: string | null;
  callerAvatar?: string | null;
};

function ringFromRow(row: CallNotificationRow): Ring | null {
  const conversationId = row.metadata?.conversation_id ?? row.metadata?.conversationId;
  const callerId = row.metadata?.caller_id;
  if (!conversationId || !callerId) return null;
  return {
    conversationId,
    callerId,
    callId: row.metadata?.call_id ?? row.metadata?.callId ?? null,
    createdAt: new Date(row.created_at).getTime(),
    callerName: (row.metadata?.caller_name as string) ?? (row.metadata?.callerName as string) ?? null,
    callerAvatar: (row.metadata?.caller_avatar as string) ?? (row.metadata?.callerAvatar as string) ?? null,
  };
}

function isFresh(ring: Ring): boolean {
  return Date.now() - ring.createdAt < RING_WINDOW_MS;
}

export default function CallSessionProvider() {
  const { showToast } = useToast();
  const call = useCallSession();

  /** The `notifications` row this overlay came from, if it came from one.
      `postgres_changes` DELETE payloads carry nothing but the primary key, and
      an unrelated notification being cleared must not hang up a live ring — so
      the id is the only honest key to match on. */
  const ringRowIdRef = useRef<string | null>(null);

  /* One resolved identity per peer, which is all the call surfaces need to
     draw a person: the anonymous name and the generated face. */
  const peerIds = useMemo(() => (call.peerId ? [call.peerId] : []), [call.peerId]);
  const nameOf = useAnonNames(peerIds);

  /* ---------------------------------------------------------------- */
  /* Notices: the engine has no UI, so its sentences arrive here.      */
  /* ---------------------------------------------------------------- */
  useEffect(() => callSession.onNotice((message) => showToast(message)), [showToast]);

  /* ---------------------------------------------------------------- */
  /* Identity                                                          */
  /* ---------------------------------------------------------------- */
  useEffect(() => {
    let active = true;

    void supabase.auth.getSession().then(({ data }) => {
      if (active) callSession.setIdentity(data.session?.user?.id ?? null);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      callSession.setIdentity(session?.user?.id ?? null);
    });

    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  /* ---------------------------------------------------------------- */
  /* Rings, from all three paths                                       */
  /* ---------------------------------------------------------------- */
  /**
   * `rowId` is the row the engine can trust: a ring derived from an unread
   * `notifications` row is a live call by construction (the server marks the
   * row read the moment the call ends). A ring without one (a push tap, an
   * offer that arrived first) is verified against `call_logs` inside
   * beginIncomingRing — that is the check that keeps a tap on a stale
   * notification from ringing a call that has already ended.
   */
  const showRing = useCallback((ring: Ring, rowId: string | null) => {
    if (!isFresh(ring)) return;
    ringRowIdRef.current = rowId;
    void callSession.beginIncomingRing({ ...ring, rowId });
  }, []);

  /** The cold-start query: unread `call` rows still inside the ring window. */
  const loadPending = useCallback(async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const userId = session?.user?.id;
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
      const parsed = ringFromRow(row);
      if (parsed && isFresh(parsed)) {
        showRing(parsed, row.id);
        return;
      }
    }
  }, [showRing]);

  useEffect(() => {
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let active = true;
    let subscribedUserId: string | null = null;

    function subscribe(userId: string) {
      if (channel) supabase.removeChannel(channel);
      subscribedUserId = userId;
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
            const parsed = ringFromRow(row);
            if (parsed) showRing(parsed, row.id);
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
            if (row.id !== ringRowIdRef.current) return;
            if (row.type !== "call" || row.is_read) {
              callSession.cancelRing(row.metadata?.call_id ?? row.metadata?.callId ?? null);
              ringRowIdRef.current = null;
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
            if (row.id && row.id === ringRowIdRef.current) {
              callSession.cancelRing(null);
              ringRowIdRef.current = null;
            }
          }
        )
        .subscribe();
    }

    async function init() {
      const { data } = await supabase.auth.getSession();
      if (!active) return;
      const userId = data.session?.user?.id ?? null;
      if (!userId) return;
      subscribe(userId);
      void loadPending();
    }

    void init();

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      const nextId = session?.user?.id ?? null;
      if (nextId === subscribedUserId) return;
      if (nextId && active) {
        subscribe(nextId);
        void loadPending();
      } else if (channel) {
        supabase.removeChannel(channel);
        channel = null;
        subscribedUserId = null;
      }
    });

    /* A push tap for a call, delivered while the app is already open: show the
       overlay from the payload immediately, then reconcile against the row. */
    function onPushCall(event: Event) {
      const detail = (
        event as CustomEvent<{
          conversationId?: string;
          callerId?: string | null;
          callId?: string | null;
          callerName?: string | null;
          callerAvatar?: string | null;
        }>
      ).detail;
      if (!detail?.conversationId || !detail.callerId) return;
      showRing(
        {
          conversationId: detail.conversationId,
          callerId: detail.callerId,
          callId: detail.callId ?? null,
          createdAt: Date.now(),
          callerName: detail.callerName ?? null,
          callerAvatar: detail.callerAvatar ?? null,
        },
        null
      );
      /* Reconcile: the payload ring carries no row id, so the row query swaps
         in the durable one the moment it answers. */
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
          callerName?: string | null;
          callerAvatar?: string | null;
          at?: number;
        };
        if (
          pending?.conversationId &&
          pending.callerId &&
          typeof pending.at === "number" &&
          Date.now() - pending.at < RING_WINDOW_MS
        ) {
          showRing(
            {
              conversationId: pending.conversationId,
              callerId: pending.callerId,
              callId: pending.callId ?? null,
              createdAt: pending.at,
              callerName: pending.callerName ?? null,
              callerAvatar: pending.callerAvatar ?? null,
            },
            null
          );
        } else {
          sessionStorage.removeItem(PENDING_CALL_KEY);
        }
      }
    } catch {
      /* Corrupt stash — the row query above is the backstop. */
    }

    return () => {
      active = false;
      listener.subscription.unsubscribe();
      window.removeEventListener(INCOMING_CALL_EVENT, onPushCall);
      if (channel) supabase.removeChannel(channel);
    };
  }, [loadPending, showRing]);

  /* ---------------------------------------------------------------- */
  /* Phantom clear on unmount / background resume                                */
  /* ---------------------------------------------------------------- */
  useEffect(() => {
    // Cleanup when provider unmounts (app killed, navigation away)
    return () => {
      void callSession.forceClearPhantom();
    };
  }, []);

  useEffect(() => {
    function onVisibility() {
      if (document.visibilityState === "visible") {
        // A paused WebView kills the transport without a final state change:
        // a call that was live now sits "in_call" over a dead pipe. Judge it
        // first, so the pill does not keep counting over a ghost.
        callSession.checkHealth();
        // If we were backgrounded during a ringing leg, clear stale rows
        // so next startCall doesn't see phantom busy
        if (call.status === "idle") {
          void callSession.forceClearPhantom();
        }
      }
    }
    function onResume() {
      callSession.checkHealth();
      if (call.status === "idle") void callSession.forceClearPhantom();
    }
    document.addEventListener("visibilitychange", onVisibility);
    // Capacitor resume (native background -> foreground)
    let appListener: { remove: () => void } | null = null;
    try {
      import("@capacitor/app").then(({ App }) => {
        App.addListener("resume", onResume).then((h) => (appListener = h));
      });
    } catch {}
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      if (appListener) appListener.remove();
    };
  }, [call.status]);

  /* ---------------------------------------------------------------- */
  /* Actions                                                           */
  /* ---------------------------------------------------------------- */

  const clearStash = () => {
    try {
      sessionStorage.removeItem(PENDING_CALL_KEY);
    } catch {
      /* Storage unavailable — the engine's state is what matters. */
    }
  };

  const accept = useCallback(() => {
    clearStash();
    void callSession.accept();
  }, []);

  const decline = useCallback(() => {
    clearStash();
    const rowId = ringRowIdRef.current;
    ringRowIdRef.current = null;
    callSession.decline();
    /* `end_call_log('declined')` retires the device banner but deliberately
       leaves the row unread — it is still an entry in the activity list. The
       ring, though, must not be able to come back: an unread `call` row inside
       the 60s window is exactly what the cold-start query looks for, so a
       declined call would re-ring on the next reload. Read it here. */
    if (rowId) {
      void supabase
        .from("notifications")
        .update({ is_read: true })
        .eq("id", rowId)
        .then(() => {});
    }
  }, []);

  const hangUp = useCallback(() => callSession.hangUp("Call ended."), []);
  const toggleMute = useCallback(() => callSession.toggleMute(), []);
  const toggleSpeaker = useCallback(() => void callSession.toggleSpeaker(), []);
  const expand = useCallback(() => callSession.setMinimized(false), []);
  const minimize = useCallback(() => callSession.setMinimized(true), []);

  /* ---------------------------------------------------------------- */
  /* Surfaces                                                          */
  /* ---------------------------------------------------------------- */

  const prefetchedName = (call as unknown as { peerName?: string | null }).peerName;
  const prefetchedAvatar = (call as unknown as { peerAvatar?: string | null }).peerAvatar;
  const name = prefetchedName || (call.peerId ? nameOf(call.peerId) || "Anonymous Friend" : "Anonymous Friend");
  const avatarUrl = prefetchedAvatar || generatedAvatarUrl(call.peerId ?? "ghost");
  // Skeleton briefly when incoming ring hasn't yet delivered peer identity via FCM prefetch
  const isSheetLoading = call.status === "connecting" && !prefetchedName && !prefetchedAvatar;
  /* Narrowed once, here: `live` as a boolean would leave `call.status` too wide
      for the two surfaces that cannot render a ring or an idle engine. */
  const activeStatus =
    call.status === "outgoing" || call.status === "connecting" || call.status === "in_call"
      ? call.status
      : null;

  // Auto-answer / decline when routed via ?answer=true or ?action=decline (FCM action tap)
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (call.status !== "incoming") return;
    try {
      const params = new URLSearchParams(window.location.search);
      const answer = params.get("answer");
      const action = params.get("action");
      const callIdParam = params.get("callId") ?? params.get("call_id");
      const matchesCall = !callIdParam || !call.callId || callIdParam === call.callId;
      if (!matchesCall) return;
      if (answer === "true") {
        try { sessionStorage.removeItem(PENDING_CALL_KEY); } catch {}
        void callSession.accept();
      } else if (action === "decline") {
        const rowId = ringRowIdRef.current;
        ringRowIdRef.current = null;
        callSession.decline();
        if (rowId) {
          void supabase.from("notifications").update({ is_read: true }).eq("id", rowId);
        }
      }
    } catch {}
  }, [call.status, call.callId]);

  return (
    <>
      {/* The ring. Strictly enforced: no route is exempt, there is no
          backdrop-tap close, and the only ways out are Accept, Decline or the
          60 seconds the server allows a call to ring for. */}
      {call.status === "incoming" && (
        <IncomingCallOverlay
          name={name}
          avatarUrl={avatarUrl}
          onAccept={accept}
          onDecline={decline}
        />
      )}

      {/* Answered calls collapse to the pill, which is the whole point of the
          engine living here: it floats over every route, and the call behind it
          keeps running while the user does something else. */}
      <AnimatePresence>
        {activeStatus && call.minimized && (
          <InCallPill
            key="call-pill"
            name={name}
            avatarUrl={avatarUrl}
            status={activeStatus}
            startedAt={call.startedAt}
            muted={call.muted}
            onExpand={expand}
            onToggleMute={toggleMute}
            onHangUp={hangUp}
          />
        )}
      </AnimatePresence>

      {activeStatus && !call.minimized && (
        <InCallSheet
          name={name}
          avatarUrl={avatarUrl}
          status={activeStatus}
          startedAt={call.startedAt}
          muted={call.muted}
          speakerSupported={call.speakerSupported}
          speakerOn={call.speakerOn}
          onToggleMute={toggleMute}
          onToggleSpeaker={toggleSpeaker}
          onHangUp={hangUp}
          onMinimize={minimize}
          isLoading={isSheetLoading}
        />
      )}
    </>
  );
}
