"use client";

import { AlertCircle, RotateCw } from "lucide-react";
import MessageTicks from "@/components/MessageTicks";

/**
 * The send state, drawn next to the timestamp.
 *
 * Three states, and the design rule for all of them is that the indicator must be
 * smaller than the message it describes:
 *
 *   SENDING — a 10px clock. Not a spinner. Nothing rotates, and the composer stays
 *     usable, because a send that takes two seconds on a bad connection is not a
 *     reason to stop someone typing the next message.
 *   SENT    — the existing tick, unchanged.
 *   FAILED  — a small alert plus "Couldn't send" and a Retry that is a real button,
 *     not a hint.
 *
 * WHY THE WHOLE BUBBLE DOESN'T SPIN
 *
 * The previous behaviour awaited the insert before the message appeared, so the
 * send button was the only thing that could show progress and it spent the whole
 * request spinning. That couples the composer to the network. This decouples them:
 * the message is on screen immediately, and the pending state lives on the message
 * where the uncertainty actually is.
 */

export type SendState = "sending" | "failed" | undefined;

export default function MessageStatus({
  sendState,
  deliveredAt,
  readAt,
  onRetry,
}: {
  sendState: SendState;
  deliveredAt: string | null;
  readAt: string | null;
  onRetry?: () => void;
}) {
  if (sendState === "sending") {
    return (
      <span
        className="inline-flex items-center"
        title="Sending"
        aria-label="Sending"
        role="status"
      >
        {/* A clock, not a loader. `currentColor` so it inherits the timestamp's
            colour on either bubble fill, exactly like the tick does. */}
        <svg width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden>
          <circle cx="6" cy="6" r="4.6" stroke="currentColor" strokeWidth="1.4" opacity="0.85" />
          <path d="M6 3.6V6l1.7 1.1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      </span>
    );
  }

  if (sendState === "failed") {
    return (
      <span className="inline-flex items-center gap-1" role="alert">
        <AlertCircle
          size={10}
          className="flex-none"
          style={{ color: "var(--theme-error)" }}
          aria-hidden
        />
        <span className="text-[9.5px] font-bold leading-none" style={{ color: "var(--theme-error)" }}>
          Couldn&apos;t send
        </span>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex items-center gap-0.5 text-[9.5px] font-bold leading-none underline underline-offset-2 transition hover:opacity-80"
            style={{ color: "var(--theme-error)" }}
          >
            <RotateCw size={9} aria-hidden />
            Retry
          </button>
        )}
      </span>
    );
  }

  return <MessageTicks deliveredAt={deliveredAt} readAt={readAt} />;
}
