"use client";

import { useMemo, useSyncExternalStore } from "react";
import { callSession, type AttachedThread, type CallSnapshot } from "./callSession";

/**
 * The read side of the call engine.
 *
 * A hook, but not the owner: `callSession` is a module singleton that outlives
 * every component, which is the whole point — a call has to keep running while
 * the user walks from the chat page to the feed and back. What this returns is
 * an immutable snapshot of that engine plus the engine's own stable actions, so
 * a component can read `status` during render and call `hangUp()` from an event
 * handler without either one going stale.
 *
 * `useSyncExternalStore` rather than a `useState` + subscription effect: the
 * engine publishes from inside WebRTC and realtime callbacks, i.e. outside
 * React's batch in React 17 terms, and tearing between two subscribers on one
 * screen (the pill and the chat header) is exactly what this API exists to
 * prevent.
 */

export type CallSessionApi = CallSnapshot & {
  /** Place a call. The server refuses anything illegal before a mic opens. */
  startCall: (target: { conversationId: string; peerId: string }) => Promise<void>;
  accept: () => Promise<void>;
  decline: () => void;
  hangUp: (notify?: string | null, reason?: "timeout" | "user") => void;
  toggleMute: () => void;
  toggleSpeaker: () => Promise<void>;
  setMinimized: (minimized: boolean) => void;
  /** "I am looking at this thread, it can ring." Returns the detach. */
  attachThread: (thread: AttachedThread) => () => void;
};

export function useCallSession(): CallSessionApi {
  const snapshot = useSyncExternalStore(
    callSession.subscribe,
    callSession.getSnapshot,
    callSession.getSnapshot
  );

  /* The actions are arrow-function properties on the singleton, so their
     identity never changes; only the snapshot drives the memo. */
  return useMemo(
    () => ({
      ...snapshot,
      startCall: callSession.startCall,
      accept: callSession.accept,
      decline: callSession.decline,
      hangUp: callSession.hangUp,
      toggleMute: callSession.toggleMute,
      toggleSpeaker: callSession.toggleSpeaker,
      setMinimized: callSession.setMinimized,
      attachThread: callSession.attachThread,
    }),
    [snapshot]
  );
}

export default useCallSession;
