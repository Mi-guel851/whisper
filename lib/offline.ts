"use client";

import { Network } from "@capacitor/network";

/**
 * One answer to "are we online", shared by everything that needs it.
 *
 * WHY THIS IS CENTRAL AND NOT A HOOK PER CALLER
 *
 * `Network.addListener` is a bridge subscription. Two components asking
 * independently is two bridge listeners for one boolean, and — worse — two
 * sources of truth that can disagree for a frame, which is how an "offline"
 * banner ends up on screen at the same moment a request succeeds. So the listener
 * is attached once, lazily, and every caller reads the same cached value.
 *
 * `navigator.onLine` is the web fallback. It is famously weak — it reports "true"
 * for a connection that goes nowhere — which is exactly why it is the *fallback*
 * and why nothing in the app treats `isOnline()` as permission to skip error
 * handling. It is used to explain a failure and to know when to retry, never to
 * predict success.
 *
 * The Capacitor plugin is genuinely better on Android, where it reads the real
 * network state rather than guessing from a socket.
 */

type Listener = (online: boolean) => void;

const listeners = new Set<Listener>();

/** Optimistic until proven otherwise: a false "offline" is the worse mistake. */
let online = true;
let started = false;

function publish(next: boolean) {
  if (next === online) return;
  online = next;
  for (const listener of listeners) listener(next);
}

function start() {
  if (started || typeof window === "undefined") return;
  started = true;

  if (typeof navigator !== "undefined" && typeof navigator.onLine === "boolean") {
    online = navigator.onLine;
  }

  /* Both sources are wired up rather than one or the other. In the Capacitor
     shell the plugin is authoritative, but the browser events still fire and
     agree; on the web the plugin call rejects and only the events matter. */
  window.addEventListener("online", () => publish(true));
  window.addEventListener("offline", () => publish(false));

  void Network.getStatus()
    .then((status) => publish(status.connected))
    .catch(() => {
      /* No plugin in this build, or a browser. The window events cover it. */
    });

  void Network.addListener("networkStatusChange", (status) => {
    publish(status.connected);
  }).catch(() => {});
}

/**
 * Current connectivity. Safe during SSR, where it reports true — a server render
 * has no network state to report and pessimism would flash an offline banner into
 * the first paint of every page.
 */
export function isOnline(): boolean {
  if (typeof window === "undefined") return true;
  start();
  return online;
}

/**
 * Subscribe to changes. Fires only on transitions, and returns an unsubscribe.
 *
 * Callers that need to catch up after a gap — refetching a count, resubscribing a
 * realtime channel — should act on the `true` transition rather than polling.
 */
export function subscribeToConnectivity(listener: Listener): () => void {
  start();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Guard for an action that cannot work offline.
 *
 * Returns false and explains why, so a write refuses with a sentence a person can
 * act on instead of a raw `TypeError: Failed to fetch`. Deliberately does *not*
 * queue anything: this app sends anonymous messages, spends coins and posts to a
 * public feed, and an action that silently completes hours later — after the
 * conversation moved on, against a balance that has since changed — is worse than
 * one that plainly did not happen.
 */
export function requireOnline(
  notify: (message: string) => void,
  action = "That"
): boolean {
  if (isOnline()) return true;
  notify(`${action} needs a connection. You're offline right now.`);
  return false;
}
