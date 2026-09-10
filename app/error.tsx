"use client";

import { useEffect } from "react";
import ErrorScreen from "@/components/ErrorScreen";
import { debugErrorsEnabled } from "@/lib/safeErrorMessage";

/**
 * Error boundary for every segment below the root layout.
 *
 * Without this file, any unhandled client-side exception renders Next.js'
 * built-in developer-facing error screen — the one that tells a regular user
 * to look at their browser console. This file replaces it with the one screen
 * a person is meant to read: ErrorScreen.
 *
 * The full error always goes to the deployment log (and React DevTools in
 * dev). On the page itself it is shown only to the allowlisted admin accounts
 * (AdminDebugGate flips the flag from the session) — for everyone else the
 * screen carries the friendly copy and nothing more. The `digest` is Next's
 * stable id for the same server error across requests, and it is the only part
 * of the error safe to keep around for a support ticket.
 */
export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[whisper] client error boundary:", error, error.digest ? `(digest ${error.digest})` : "");
  }, [error]);

  const detail = debugErrorsEnabled()
    ? (error.stack && error.stack.length > 0 ? error.stack : error.message)
    : undefined;

  return <ErrorScreen onRetry={reset} detail={detail} />;
}
