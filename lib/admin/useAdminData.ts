"use client";

import { useCallback, useEffect, useState } from "react";

import { adminFetch } from "@/lib/admin/client";

/**
 * The shape every admin error surfaces as.
 *
 * One object rather than a bare string because a missing `ADMIN_GRANT_PIN` has
 * to be reported differently from a wrong one: the first is a server
 * configuration problem the admin cannot fix by retyping, and telling them to
 * retype sends them hunting for a typo that does not exist.
 */
export type AdminError = {
  message: string;
  misconfigured: boolean;
};

function toAdminError(cause: unknown): AdminError {
  let message = cause instanceof Error ? cause.message : "Request failed.";
  /* A dead network surfaces as the browser's own "Failed to fetch" — a
     system string. The operator sees the real cause in the request log; the
     panel gets words that point at the thing to check. */
  if (/failed to fetch|network request failed|load failed/i.test(message)) {
    message = "Couldn't reach the server. Check your connection and try again.";
  }
  return {
    message,
    misconfigured: /ADMIN_GRANT_PIN|server configuration/i.test(message),
  };
}

/**
 * One request, its loading flag, its error, and a way to re-run it.
 *
 * Every admin section needs the same four things, and writing them four times is
 * how one section ends up without an error state. It is deliberately small: it
 * is not a cache and it does not dedupe across sections — each section asks for
 * exactly one path, and the server-side cache in the admin RPCs is where
 * repetition is actually absorbed.
 */
export function useAdminData<T>(
  path: string,
  options: {
    /**
     * Skip the request entirely. Used for the user-detail call, which must not
     * fire until a row is actually selected.
     */
    skip?: boolean;
  } = {}
) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<AdminError | null>(null);
  /* The key of the request that last resolved, rather than a `loading` boolean
     flipped at the top of the effect.

     The distinction is what keeps the effect body free of synchronous state
     updates: `loading` is derived by comparing the key being fetched with the
     one that finished, so a new path or a manual reload makes it true on its own
     without the effect having to say so. The effect only ever writes state from
     inside the promise, which is a response to the network rather than a
     cascading render. */
  const [doneKey, setDoneKey] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const skipped = Boolean(options.skip) || !path;
  const key = `${path}#${tick}`;
  const loading = !skipped && doneKey !== key;

  const reload = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    if (skipped) return;

    const controller = new AbortController();
    let cancelled = false;

    adminFetch<T>(path, { signal: controller.signal })
      .then((value) => {
        if (cancelled) return;
        setData(value);
        setError(null);
        setDoneKey(key);
      })
      .catch((cause: unknown) => {
        /* An aborted in-flight request is the previous key being superseded, not
           a failure. Surfacing it would put "request failed" over data that is
           simply on its way. */
        if (cancelled || controller.signal.aborted) return;
        setError(toAdminError(cause));
        setDoneKey(key);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [path, key, skipped, tick]);

  return { data, loading, error, reload };
}

/** The discriminated result of a mutation: either it worked, or it did not. */
export type AdminActionResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string; misconfigured: boolean };

/**
 * Runs one admin mutation and normalises its failure.
 *
 * A plain async function rather than a hook: mutations are fired from handlers
 * that already own their own `busy` flag, and a hook here would force every
 * caller to hoist one action per button. Every admin write shares the same
 * three-part failure surface — the request failed, the PIN was wrong, or the
 * database refused the write — and collapsing it into one message is what lets a
 * caller show something specific instead of "request failed".
 */
export async function runAdminAction<T>(
  action: () => Promise<T>
): Promise<AdminActionResult<T>> {
  try {
    const value = await action();
    return { ok: true, value };
  } catch (cause) {
    const { message, misconfigured } = toAdminError(cause);
    return { ok: false, error: message, misconfigured };
  }
}

/**
 * A debounced value, for search boxes that would otherwise send a request per
 * keystroke against a table with tens of thousands of rows.
 *
 * 300ms is the compromise: long enough that typing a username produces one
 * request, short enough that the delay is not noticeable.
 */
export function useDebounced<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debounced;
}
