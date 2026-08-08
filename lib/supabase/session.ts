"use client";

import type { Session } from "@supabase/supabase-js";
import { supabase } from "./client";

/**
 * A process-wide cache for the current session.
 *
 * `supabase.auth.getSession()` was being called 26 times across 19 files — once
 * per page mount, again in BottomNavigation, again in the providers. Every one
 * of those is an `await`, and almost all of them sit at the *front* of a page's
 * init chain, gating first paint. Even when it resolves from local storage it
 * costs a JSON parse, a token-expiry check, and at least one microtask turn
 * before the page can start the query it actually wanted; when the access token
 * is near expiry it costs a network round trip to refresh, and every caller pays
 * that separately.
 *
 * The session is a single piece of app-wide state, so it is fetched once and
 * kept current by `onAuthStateChange` — which supabase-js fires immediately with
 * `INITIAL_SESSION`, and again on every refresh, sign-in and sign-out. After the
 * first call this resolves from memory on the same tick, so a page navigation no
 * longer begins with a round trip.
 *
 * Drop-in for the old pattern:
 *
 *   const { data: { session } } = await supabase.auth.getSession();
 *   const session = await getCachedSession();
 */

let cached: Session | null = null;
let resolved = false;
let inflight: Promise<Session | null> | null = null;
let listening = false;

/**
 * Attach the listener that keeps the cache honest. Registered lazily on first
 * read rather than at module load, so importing this file from a server
 * component or a route that never authenticates doesn't open a subscription.
 */
function ensureListening() {
  if (listening) return;
  listening = true;

  supabase.auth.onAuthStateChange((_event, session) => {
    cached = session;
    resolved = true;
    /* A refresh landing mid-flight makes the in-flight promise stale. Clearing
       it means the next caller reads the value we just received rather than
       waiting on a request that is about to resolve with the older one. */
    inflight = null;
    notify(session);
  });
}

type SessionListener = (session: Session | null) => void;
const listeners = new Set<SessionListener>();

function notify(session: Session | null) {
  listeners.forEach((listener) => {
    try {
      listener(session);
    } catch {
      /* One bad subscriber must not stop the others from being told. */
    }
  });
}

/**
 * Observe sign-in / sign-out / refresh. Returns an unsubscribe function.
 * Used by the nav badge store to reset itself when the user changes.
 */
export function onSessionChange(listener: SessionListener) {
  ensureListening();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * The session if it is already known, without waiting. Returns `undefined` when
 * the cache has not been populated yet — which is distinct from `null`, meaning
 * "definitely signed out". Lets a component render its authenticated shell on
 * the first frame instead of showing a loader for a value it already has.
 */
export function peekSession(): Session | null | undefined {
  return resolved ? cached : undefined;
}

/** The current session, from memory after the first call. */
export async function getCachedSession(): Promise<Session | null> {
  ensureListening();

  if (resolved) return cached;
  if (inflight) return inflight;

  inflight = supabase.auth
    .getSession()
    .then(({ data }) => {
      /* `onAuthStateChange` may have resolved this first — it fires
         `INITIAL_SESSION` as soon as the listener attaches. Its value is the
         newer one, so don't overwrite it with this response. */
      if (!resolved) {
        cached = data.session;
        resolved = true;
      }
      inflight = null;
      return cached;
    })
    .catch(() => {
      /* A failed read is not a signed-out user. Leave the cache unresolved so
         the next caller retries rather than caching a wrong `null`. */
      inflight = null;
      return null;
    });

  return inflight;
}

/** The signed-in user's id, or null. Convenience for the common case. */
export async function getCachedUserId(): Promise<string | null> {
  const session = await getCachedSession();
  return session?.user?.id ?? null;
}
