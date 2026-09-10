"use client";

import { Phone, PhoneIncoming, PhoneOutgoing } from "lucide-react";

import {
  canCallBack,
  describeCallEntry,
  type CallEntryInfo,
} from "@/lib/calls/callFormat";

/**
 * A call outcome, in the conversation where it happened.
 *
 * This row is not a message the client invented: it renders one
 * `public.call_logs` row (start_call_log wrote it when the call began;
 * end_call_log or the expiry sweep closed it). A missed call therefore
 * survives the recipient being offline, closing the tab, or losing the
 * WebSocket entirely — they come back and the entry is simply part of the
 * thread, like it always was; the thread only learned to read it.
 *
 * Visual language mirrors the day-chips and system notices already in the
 * chat: centered, compact, solid `--theme-surface-solid` surface with an
 * elevation shadow (opaque in both themes, per the overlay rules in
 * globals.css), never a floating gradient over live content. Danger tones use
 * the same rose the unread badge uses so a missed call reads as "needs you"
 * at a glance without screaming.
 */
type CallEntryRowProps = {
  entry: CallEntryInfo;
  viewerId: string;
  /** Accepted friendship — the only state in which calling back is offered. */
  isFriend: boolean;
  onCallBack?: () => void;
};

export default function CallEntryRow({ entry, viewerId, isFriend, onCallBack }: CallEntryRowProps) {
  const view = describeCallEntry(entry, viewerId);
  const Icon =
    view.direction === "outgoing"
      ? entry.status === "missed" || entry.status === "expired"
        ? PhoneOutgoing
        : Phone
      : entry.status === "missed" || entry.status === "expired"
      ? PhoneIncoming
      : Phone;

  const callback = canCallBack(entry, viewerId, isFriend) && onCallBack;

  return (
    <div className="my-3 flex justify-center" data-call-entry={entry.id} data-call-status={entry.status}>
      <div
        className="inline-flex max-w-full items-center gap-2 rounded-full px-3.5 py-1.5 text-[12px] font-semibold shadow-lg shadow-black/20"
        style={{ background: "var(--theme-surface-solid)", color: "var(--text-2)" }}
      >
        <span
          aria-hidden
          className="flex h-5 w-5 items-center justify-center rounded-full"
          style={{
            background:
              view.tone === "danger"
                ? "rgba(244, 63, 94, 0.14)"
                : view.tone === "accent"
                ? "rgba(37, 211, 102, 0.14)"
                : "rgba(148, 163, 184, 0.14)",
            color:
              view.tone === "danger"
                ? "#f43f5e"
                : view.tone === "accent"
                ? "#25D366"
                : "var(--text-3)",
          }}
        >
          <Icon size={13} strokeWidth={2.4} />
        </span>

        <span className="truncate" style={{ color: view.tone === "danger" ? undefined : "var(--text-1)" }}>
          {view.label}
        </span>
        <time className="chat-meta shrink-0" dateTime={entry.started_at}>
          {formatClock(entry.started_at)}
        </time>

        {callback ? (
          <button
            type="button"
            onClick={callback}
            className="ml-1 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-black transition active:scale-95"
            style={{
              background: "linear-gradient(135deg, var(--theme-accent-from), var(--theme-accent-to))",
              color: "var(--theme-accent-contrast)",
            }}
            aria-label="Call back"
          >
            <Phone size={11} />
            Call back
          </button>
        ) : null}
      </div>
    </div>
  );
}

function formatClock(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  return at.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}
