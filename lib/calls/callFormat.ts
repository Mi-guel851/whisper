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
