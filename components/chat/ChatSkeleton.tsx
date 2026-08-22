/**
 * The message list's placeholder.
 *
 * WHY THIS EXISTS
 *
 * Opening a thread used to replace the whole screen with centred grey
 * "Loading..." text: the header vanished, the composer vanished, the doodle
 * background vanished, and then all of it reappeared at once. Even at 200ms that
 * reads as a page *load* rather than a panel opening, which is the opposite of
 * what a chat should feel like — and the back button was gone for the duration,
 * so a mis-tap left the user stranded with nothing to press.
 *
 * Now the frame paints immediately and only this region is provisional. The
 * geometry deliberately mirrors `MessageBubble`: alternating sides, the same
 * `chat-bubble` surface, the same `rounded-2xl` with one squared corner, the same
 * vertical rhythm. Nothing shifts when the real messages land.
 *
 * `aria-hidden` throughout — a screen reader should hear the thread or nothing,
 * never a description of grey rectangles.
 */

/** Widths in ch-ish percentages, mixed so the stack reads as conversation. */
const ROWS: { mine: boolean; width: string; lines: 1 | 2 }[] = [
  { mine: false, width: "62%", lines: 1 },
  { mine: true, width: "48%", lines: 1 },
  { mine: true, width: "70%", lines: 2 },
  { mine: false, width: "55%", lines: 1 },
  { mine: false, width: "74%", lines: 2 },
  { mine: true, width: "40%", lines: 1 },
];

export default function ChatSkeleton() {
  return (
    <div aria-hidden="true" className="relative">
      {/* A day chip, because a real thread almost always opens under one and its
          absence would be the one visible jump when the messages arrive. */}
      <div className="my-4 flex justify-center">
        <div className="skeleton h-6 w-20 rounded-full" />
      </div>

      {ROWS.map((row, index) => (
        <div
          key={index}
          className={`mb-2 flex ${row.mine ? "justify-end" : "justify-start"}`}
        >
          <div
            className={`chat-bubble max-w-[78%] rounded-2xl px-3 py-2.5 ${
              row.mine ? "rounded-br-sm" : "rounded-bl-sm"
            }`}
            style={{ width: row.width }}
          >
            <div className="skeleton h-3 w-full rounded-full" />
            {row.lines === 2 && (
              <div className="skeleton mt-2 h-3 w-[72%] rounded-full" />
            )}
            {/* The timestamp slot. Right-aligned on both sides, matching the
                real bubble's meta row. */}
            <div className="mt-2 flex justify-end">
              <div className="skeleton h-2 w-8 rounded-full" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
