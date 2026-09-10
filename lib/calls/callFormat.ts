/**
 * Call duration formatting for the in-call sheet.
 *
 * Pure on purpose: the sheet re-renders every second, and "3:07" must be the
 * same string on every render and on every device — a formatter that drifts
 * between renders reads as a broken timer, which is how the user learns not
 * to trust the rest of the call UI.
 */
export function formatCallDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  /* Hours only past the hour — a "1:02:03" on a one-hour call would look
     like a formatting error more than it would look impressive. */
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    return `${hours}:${String(minutes % 60).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/**
 * Call-log entry rendering for the chat timeline (202609100006).
 *
 * The statuses are the SERVER's words — the client never derives "missed"
 * from presence or a local timer; it reads the row that start_call_log /
 * end_call_log / the expiry sweep wrote. Direction is relative to the viewer:
 * a `missed` row is an INCOMING call that was not answered, an `expired` row
 * is a call whose RING expired (caller walked away, or their device died),
 * `canceled` is the caller's own hang-up before an answer, `declined` the
 * callee's, `completed` a call that connected and later ended.
 */
export type CallEntryStatus =
  | "ringing"
  | "answered"
  | "completed"
  | "missed"
  | "expired"
  | "canceled"
  | "declined"
  | "busy";

export type CallEntryInfo = {
  /** Row id (public.call_logs.id) — the dedup key the timeline uses. */
  id: string;
  caller_id: string;
  callee_id: string;
  started_at: string;
  ended_at: string | null;
  status: CallEntryStatus;
};

export type CallEntryView = {
  label: string;
  /** Whether to draw the phone icon tilted (outgoing) or straight (incoming). */
  direction: "incoming" | "outgoing";
  tone: "danger" | "neutral" | "accent";
  /** Duration text, when the call actually connected. */
  duration: string | null;
  /** A stale `ringing` row (its window has passed) reads as expired, not as
      an eternal "Calling…" — the sweep will agree shortly. */
  stale: boolean;
};

const RING_WINDOW_MS = 60_000;

export function describeCallEntry(
  entry: CallEntryInfo,
  viewerId: string,
  now: number = Date.now()
): CallEntryView {
  const direction = entry.caller_id === viewerId ? "outgoing" : "incoming";
  const started = Date.parse(entry.started_at);
  const stale = (entry.status === "ringing" || entry.status === "answered")
    && Number.isFinite(started)
    && now - started > RING_WINDOW_MS + 15_000;

  let duration: string | null = null;
  if (entry.ended_at && (entry.status === "completed" || (entry.status === "answered"))) {
    const ms = Date.parse(entry.ended_at) - started;
    if (Number.isFinite(ms) && ms >= 0) duration = formatCallDuration(ms);
  }

  if (entry.status === "ringing") {
    return stale
      ? { label: direction === "outgoing" ? "No answer" : "Missed voice call", direction, tone: "danger", duration: null, stale }
      : { label: direction === "outgoing" ? "Calling…" : "Incoming call…", direction, tone: "neutral", duration: null, stale };
  }
  if (entry.status === "answered" || entry.status === "completed") {
    return {
      label: `Voice call${duration ? ` · ${duration}` : ""}`,
      direction,
      tone: "accent",
      duration,
      stale,
    };
  }
  if (entry.status === "missed" || entry.status === "expired") {
    return {
      label: direction === "outgoing" ? "No answer" : "Missed voice call",
      direction,
      tone: "danger",
      duration: null,
      // The ringing branch above owns the stale case; a recorded miss is a miss.
      stale: false,
    };
  }
  if (entry.status === "declined") {
    return {
      label: direction === "outgoing" ? "Call declined" : "Declined a call",
      direction,
      tone: "danger",
      duration: null,
      stale,
    };
  }
  if (entry.status === "busy") {
    return { label: "Busy", direction, tone: "neutral", duration: null, stale };
  }
  return { label: "Call cancelled", direction, tone: "neutral", duration: null, stale };
}

/** Whether the viewer may tap "Call back" on this row. */
export function canCallBack(entry: CallEntryInfo, viewerId: string, isFriend: boolean): boolean {
  // Only an unanswered call FROM the other person is a callback offer, and
  // only inside an accepted friendship (the server also refuses otherwise —
  // start_call_log re-checks every rule; this only decides whether to render).
  if (!isFriend) return false;
  if (entry.caller_id === viewerId) return false;
  return ["missed", "expired", "canceled", "declined"].includes(entry.status);
}
