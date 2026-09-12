import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { AppState, BackHandler } from "react-native";

import { supabase } from "@/lib/supabase";
import { callSession } from "@/lib/calls/callSession";
import {
  subscribeIncomingCallRings,
  takePendingRing,
} from "@/lib/calls/pendingRing";
import { useAnonName } from "@/lib/identity";
import { useSession } from "@/lib/session";
import { useToast } from "@/lib/toast";

import IncomingCallOverlay from "./IncomingCallOverlay";
import InCallSheet from "./InCallSheet";
import InCallPill from "./InCallPill";

/**
 * The call, owned by the app rather than by a screen.
 *
 * The native port of the web app's `components/calls/CallSessionProvider.tsx`,
 * mounted once in the root layout next to the other "not a route" providers.
 * Three jobs, the same three the web provider has:
 *
 *   1. FINDS the ring. Three paths converge here: a realtime INSERT on
 *      `public.notifications` typed `call` (the app is open), a cold-start
 *      query of unread `call` rows still inside the 60s window (the app was
 *      opened mid-ring), and a push tap — the in-memory emitter, or the
 *      AsyncStorage stash a killed-state tap left behind. All three hand the
 *      same shape to `callSession`.
 *
 *   2. ENFORCES the overlay on every route, with no exceptions. There is
 *      exactly one overlay and it appears wherever the user is standing.
 *
 *   3. RENDERS the surfaces from the engine's state: the full-screen ring,
 *      the full-screen in-call sheet, or — the moment a call is answered or
 *      minimized — the pill at the top. Mounted at the root, so the pill is
 *      still there after any navigation, and the call behind it is still live.
 */

/** How long a ring is showable, matching the server's 60s ring window. */
const RING_WINDOW_MS = 60_000;

type CallNotificationRow = {
  id: string;
  created_at: string;
  is_read: boolean;
  type?: string;
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
  const { userId } = useSession();
  const { showToast } = useToast();

  const call = useSyncExternalStore(callSession.subscribe, callSession.getSnapshot);

  /** The `notifications` row this overlay came from, if any. A DELETE payload
      carries nothing but the primary key, so the id is the only honest key. */
  const [ringRowId, setRingRowId] = useState<string | null>(null);

  const peerId = call.peerId;
  const fallbackName = useAnonName(peerId);
  const name = useMemo(
    () => call.peerName || (peerId ? fallbackName || "Anonymous Friend" : "Anonymous Friend"),
    [call.peerName, fallbackName, peerId]
  );
  const avatarUrl = call.peerAvatar ?? null;

  /* ---------------------------------------------------------------- */
  /* Notices: the engine has no UI, so its sentences arrive here.      */
  /* ---------------------------------------------------------------- */
  useEffect(() => callSession.onNotice((message) => showToast(message, { variant: "subtle" })), [showToast]);

  /* ---------------------------------------------------------------- */
  /* Identity                                                          */
  /* ---------------------------------------------------------------- */
  useEffect(() => {
    callSession.setIdentity(userId);
  }, [userId]);

  /* ---------------------------------------------------------------- */
  /* Rings, from all paths                                             */
  /* ---------------------------------------------------------------- */
  const showRing = useCallback((ring: Ring, rowId: string | null) => {
    if (!isFresh(ring)) return;
    setRingRowId(rowId);
    void callSession.beginIncomingRing({ ...ring, rowId });
  }, []);

  /** The cold-start query: unread `call` rows still inside the ring window. */
  const loadPending = useCallback(async () => {
    if (!userId) return;
    const since = new Date(Date.now() - RING_WINDOW_MS).toISOString();
    const { data } = await supabase
      .from("notifications")
      .select("id,created_at,is_read,metadata,type")
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
  }, [showRing, userId]);

  useEffect(() => {
    if (!userId) return;

    const channel = supabase
      .channel(`global-calls-${userId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
        (payload) => {
          const row = payload.new as unknown as CallNotificationRow;
          if (row.type !== "call") return;
          const parsed = ringFromRow(row);
          if (parsed) showRing(parsed, row.id);
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
        (payload) => {
          /* Answered/declined/retired elsewhere: the row going read is this
             overlay's cue to stand down. */
          const row = payload.new as unknown as CallNotificationRow;
          if (row.id !== ringRowId) return;
          if (row.type !== "call" || row.is_read) {
            callSession.cancelRing(row.metadata?.call_id ?? row.metadata?.callId ?? null);
            setRingRowId(null);
          }
        }
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
        (payload) => {
          const row = payload.old as { id?: string };
          if (row.id && row.id === ringRowId) {
            callSession.cancelRing(null);
            setRingRowId(null);
          }
        }
      )
      .subscribe();

    void loadPending();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [loadPending, ringRowId, showRing, userId]);

  /* A push tap for a call, delivered while the app's JS is running. */
  useEffect(() => {
    return subscribeIncomingCallRings((ring) => {
      showRing(
        {
          conversationId: ring.conversationId,
          callerId: ring.callerId,
          callId: ring.callId,
          createdAt: Date.now(),
          callerName: ring.callerName,
          callerAvatar: ring.callerAvatar,
        },
        null
      );
      /* Reconcile: the payload ring carries no row id, so the row query swaps
         in the durable one the moment it answers. */
      void loadPending();
    });
  }, [loadPending, showRing]);

  /* A push tap that launched the app from a killed state: the tap handler
     stashed the payload before anything mounted. */
  useEffect(() => {
    void takePendingRing().then((pending) => {
      if (!pending) return;
      if (Date.now() - pending.at >= RING_WINDOW_MS) return;
      showRing(
        {
          conversationId: pending.conversationId,
          callerId: pending.callerId,
          callId: pending.callId,
          createdAt: pending.at,
          callerName: pending.callerName,
          callerAvatar: pending.callerAvatar,
        },
        null
      );
      void loadPending();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------------------------------------------------------------- */
  /* Phantom clear + health on app resume                              */
  /* ---------------------------------------------------------------- */
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      // A backgrounded app can kill the transport without a final state
      // change — judge the pipe first, then clear stale ringing rows so the
      // next startCall does not inherit a phantom busy.
      callSession.checkHealth();
      if (call.status === "idle") void callSession.forceClearPhantom();
    });

    return () => {
      subscription.remove();
    };
  }, [call.status]);

  useEffect(() => {
    return () => {
      void callSession.forceClearPhantom();
    };
  }, []);

  /* ---------------------------------------------------------------- */
  /* Actions                                                           */
  /* ---------------------------------------------------------------- */

  const accept = useCallback(() => {
    void callSession.accept();
  }, []);

  const decline = useCallback(() => {
    const rowId = ringRowId;
    setRingRowId(null);
    callSession.decline();
    /* `end_call_log('declined')` leaves the row unread — still an entry in
       the activity list. But an unread `call` row inside the 60s window is
       exactly what the cold-start query looks for, so a declined call would
       re-ring on the next launch. Read it here. */
    if (rowId) {
      void supabase.from("notifications").update({ is_read: true }).eq("id", rowId);
    }
  }, [ringRowId]);

  const hangUp = useCallback(() => callSession.hangUp("Call ended."), []);
  const toggleMute = useCallback(() => callSession.toggleMute(), []);
  const toggleSpeaker = useCallback(() => void callSession.toggleSpeaker(), []);
  const expand = useCallback(() => callSession.setMinimized(false), []);
  const minimize = useCallback(() => callSession.setMinimized(true), []);

  /* The ring is a modal interruption with no backdrop to tap: Android's back
     gesture declines, the same "make it stop" job the web gives to Escape. */
  useEffect(() => {
    if (call.status !== "incoming") return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      decline();
      return true;
    });
    return () => subscription.remove();
  }, [call.status, decline]);

  /* ---------------------------------------------------------------- */
  /* Surfaces                                                          */
  /* ---------------------------------------------------------------- */

  const activeStatus =
    call.status === "outgoing" || call.status === "connecting" || call.status === "in_call"
      ? call.status
      : null;

  if (call.status === "idle") return null;

  return (
    <>
      {call.status === "incoming" ? (
        <IncomingCallOverlay name={name} avatarUrl={avatarUrl} onAccept={accept} onDecline={decline} />
      ) : null}

      {activeStatus && call.minimized ? (
        <InCallPill
          name={name}
          avatarUrl={avatarUrl}
          status={activeStatus}
          startedAt={call.startedAt}
          muted={call.muted}
          onExpand={expand}
          onToggleMute={toggleMute}
          onHangUp={hangUp}
        />
      ) : null}

      {activeStatus && !call.minimized ? (
        <InCallSheet
          name={name}
          avatarUrl={avatarUrl}
          status={activeStatus}
          startedAt={call.startedAt}
          muted={call.muted}
          speakerSupported={call.speakerSupported}
          speakerOn={call.speakerOn}
          remoteStreamUrl={call.remoteStreamUrl}
          onToggleMute={toggleMute}
          onToggleSpeaker={toggleSpeaker}
          onHangUp={hangUp}
          onMinimize={minimize}
        />
      ) : null}
    </>
  );
}
