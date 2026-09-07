"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Device-level chat-list state, WhatsApp-style.
 *
 * Pinning a chat and "mark as unread" are per-device organisational choices in
 * WhatsApp, not facts about the conversation the other party needs to know — so
 * they live in localStorage keyed by the signed-in user rather than in a
 * database table the other participant's client would have to be taught to
 * ignore. A migration that adds a table, an RLS policy and a realtime channel
 * for "this row is visually bold on my phone" would be a lot of moving parts
 * for what is genuinely a local preference.
 *
 * Two sets are tracked:
 *
 *   - `pinned`   — conversation ids held at the top of the list.
 *   - `unreadAt` — conversation ids the reader deliberately marked unread,
 *                  mapped to an ISO timestamp. Marking unread FORCES the row
 *                  bold even though `last_read_at` says it was read; opening
 *                  the chat clears the override, so the unread flag never gets
 *                  stuck on after a genuine read the way a purely boolean flag
 *                  would.
 */

const STORAGE_VERSION = "v1";

function keyFor(userId: string, kind: string) {
  return `whisper-chatlist-${kind}-${STORAGE_VERSION}-${userId}`;
}

function readSet(userId: string, kind: string): Set<string> {
  try {
    const raw = window.localStorage.getItem(keyFor(userId, kind));
    return new Set(raw ? raw.split(",").filter(Boolean) : []);
  } catch {
    return new Set();
  }
}

function readMap(userId: string, kind: string): Map<string, string> {
  try {
    const raw = window.localStorage.getItem(keyFor(userId, kind));
    const map = new Map<string, string>();
    if (!raw) return map;
    for (const entry of raw.split(",").filter(Boolean)) {
      const sep = entry.lastIndexOf("@");
      if (sep > 0) map.set(entry.slice(0, sep), entry.slice(sep + 1));
    }
    return map;
  } catch {
    return new Map();
  }
}

function writeSet(userId: string, kind: string, values: Set<string>) {
  try {
    /* Bounded, same reasoning as the announcements store: a long-lived device
       must not grow this key one conversation per pin forever. */
    window.localStorage.setItem(keyFor(userId, kind), Array.from(values).slice(-200).join(","));
  } catch {
    /* Private mode — the preference just doesn't persist. */
  }
}

function writeMap(userId: string, kind: string, values: Map<string, string>) {
  try {
    const entries = Array.from(values.entries()).slice(-200);
    window.localStorage.setItem(
      keyFor(userId, kind),
      entries.map(([id, at]) => `${id}@${at}`).join(",")
    );
  } catch {
    /* Private mode. */
  }
}

export function useChatListState(userId: string) {
  const [pinned, setPinned] = useState<Set<string>>(new Set());
  const [forcedUnread, setForcedUnread] = useState<Map<string, string>>(new Map());

  /* Load lazily once the session resolves. Reading during render would differ
     between the server and client passes. localStorage is the external system
     here, so the read+hydrate belongs in an effect. */
  useEffect(() => {
    if (!userId) return;
    const loadedPinned = readSet(userId, "pinned");
    const loadedUnread = readMap(userId, "unread");
    queueMicrotask(() => {
      setPinned(loadedPinned);
      setForcedUnread(loadedUnread);
    });
  }, [userId]);

  const togglePinned = useCallback(
    (conversationId: string) => {
      setPinned((prev) => {
        const next = new Set(prev);
        if (next.has(conversationId)) next.delete(conversationId);
        else next.add(conversationId);
        if (userId) writeSet(userId, "pinned", next);
        return next;
      });
    },
    [userId]
  );

  const markUnread = useCallback(
    (conversationId: string) => {
      setForcedUnread((prev) => {
        const next = new Map(prev);
        next.set(conversationId, new Date().toISOString());
        if (userId) writeMap(userId, "unread", next);
        return next;
      });
    },
    [userId]
  );

  /** Clears a forced-unread override — called the moment a chat is opened. */
  const clearUnread = useCallback(
    (conversationId: string) => {
      setForcedUnread((prev) => {
        if (!prev.has(conversationId)) return prev;
        const next = new Map(prev);
        next.delete(conversationId);
        if (userId) writeMap(userId, "unread", next);
        return next;
      });
    },
    [userId]
  );

  return { pinned, forcedUnread, togglePinned, markUnread, clearUnread };
}
