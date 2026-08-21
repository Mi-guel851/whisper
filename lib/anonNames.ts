"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { supabase } from "@/lib/supabase/client";
import { anonymousDisplayName } from "@/lib/anonymousIdentity";

/**
 * Anonymous display names, resolved from the database.
 *
 * Every user has exactly one anonymous name and no two users share one — that
 * is a unique index plus a BEFORE INSERT trigger on `profiles`, added by
 * `202608210001_unique_identities.sql`. This module is the read side.
 *
 * Design constraints, in order of importance:
 *
 *  1. **Never render blank.** `nameOf` is synchronous. Until a stored name
 *     arrives it returns `anonymousDisplayName(id)`, the deterministic label
 *     this app used before names were stored. So a name is on screen in the
 *     first frame, and the unique one replaces it when it lands.
 *  2. **One query per screen, not one per row.** Callers ask for the ids they
 *     are about to render; requests inside the same tick coalesce into a single
 *     `in (...)` fetch. Names are cached for the life of the tab, so navigating
 *     back to the inbox refetches nothing.
 *  3. **Degrade, don't break.** If the column does not exist yet — the
 *     migration is applied by hand — the failed ids are marked resolved-empty
 *     and the deterministic label stands. One failed request, then silence.
 *
 * The fallback is not itself unique (it hashes into 7.5M names, so it collides
 * by birthday paradox in the low thousands of users). That is exactly why the
 * stored name exists; the fallback is only ever what is on screen for the few
 * hundred milliseconds before the real one arrives.
 */

/** Resolved names. A cached entry always wins over the deterministic label. */
const names = new Map<string, string>();

/** Ids we asked about and got nothing for. Prevents re-asking every mount. */
const resolvedEmpty = new Set<string>();

/** Ids waiting for the next flush. */
const pending = new Set<string>();

let flushScheduled = false;
let version = 0;
const listeners = new Set<() => void>();

/* Supabase sends `in` filters in the query string, so a very long list turns
   into a URL a proxy may refuse. Chunked well below any practical limit. */
const CHUNK = 80;

function notify() {
  version += 1;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getVersion() {
  return version;
}

async function fetchChunk(ids: string[]) {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, anon_name")
    .in("id", ids);

  if (error) {
    /* Pre-migration this is "column profiles.anon_name does not exist". Marking
       the ids resolved means we ask once per tab and then stop, instead of
       retrying on every screen that renders a name. */
    for (const id of ids) resolvedEmpty.add(id);
    return false;
  }

  let changed = false;
  for (const row of data ?? []) {
    const stored = (row as { id: string; anon_name: string | null }).anon_name;
    if (stored) {
      names.set(row.id, stored);
      changed = true;
    } else {
      resolvedEmpty.add(row.id);
    }
  }

  /* Ids that came back with no row at all — a deleted account still referenced
     by an old conversation. Nothing more to learn about them. */
  for (const id of ids) {
    if (!names.has(id)) resolvedEmpty.add(id);
  }

  return changed;
}

function scheduleFlush() {
  if (flushScheduled) return;
  flushScheduled = true;

  /* A microtask, so every component mounting in the same commit lands in one
     request. A timeout would work too but would put a visible flip a frame or
     two later than it needs to be. */
  void Promise.resolve().then(async () => {
    flushScheduled = false;
    const ids = [...pending];
    pending.clear();
    if (ids.length === 0) return;

    let changed = false;
    for (let index = 0; index < ids.length; index += CHUNK) {
      // Sequential on purpose: this is a background refinement of text that is
      // already on screen, and it should not open eight sockets to do it.
      const chunkChanged = await fetchChunk(ids.slice(index, index + CHUNK));
      changed = changed || chunkChanged;
    }

    if (changed) notify();
  });
}

function request(ids: readonly (string | null | undefined)[]) {
  let queued = false;
  for (const id of ids) {
    if (!id || names.has(id) || resolvedEmpty.has(id) || pending.has(id)) continue;
    pending.add(id);
    queued = true;
  }
  if (queued) scheduleFlush();
}

/** Synchronous read. Safe outside React — used by non-hook helpers. */
export function anonNameOf(userId?: string | null) {
  if (!userId) return anonymousDisplayName(userId);
  return names.get(userId) ?? anonymousDisplayName(userId);
}

/**
 * One name, awaited.
 *
 * For imperative code that owns the name as state rather than reading it during
 * render — the Chat header, which resolves its counterpart once inside the same
 * effect that loads the conversation. Resolves from the cache when it can, so a
 * thread opened from the Inbox costs no extra request at all.
 *
 * Notifies subscribers on a fresh hit, so a `useAnonNames` consumer mounted
 * elsewhere on the screen picks the name up from the same fetch.
 */
export async function resolveAnonName(userId: string) {
  if (names.has(userId) || resolvedEmpty.has(userId)) return anonNameOf(userId);

  const changed = await fetchChunk([userId]);
  if (changed) notify();

  return anonNameOf(userId);
}

/**
 * Resolves anonymous names for a set of users.
 *
 * Pass every id the caller is about to render. The returned function is what
 * goes in the markup; it re-renders once, when the batch lands.
 */
export function useAnonNames(ids: readonly (string | null | undefined)[]) {
  const snapshot = useSyncExternalStore(subscribe, getVersion, getVersion);

  /* `ids` is a fresh array on every render, so the effect is keyed on its
     contents rather than its identity. `request` is idempotent — already-known
     and already-queued ids fall straight through. */
  const key = ids.filter(Boolean).join(",");

  useEffect(() => {
    request(ids);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  /* A fresh closure per snapshot rather than `anonNameOf` itself. Returning the
     module function directly would hand back the same reference forever, and a
     memoised child taking this as a prop would never re-render when a name
     arrived. */
  return useCallback(
    (userId?: string | null) => anonNameOf(userId),
    [snapshot]
  );
}
