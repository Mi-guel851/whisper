"use client";

import { memo } from "react";
import { motion } from "framer-motion";
import { Check } from "lucide-react";
import { compactCount } from "@/lib/feed";
import { vibrate, HAPTIC } from "@/lib/haptics";
import { spring } from "@/lib/motion";

/**
 * A poll on a root whisper.
 *
 * Results are hidden until this viewer votes, which is the convention X and
 * Instagram both use and it exists for a real reason: a visible leader changes
 * what people pick, so a poll that shows its tallies up front is measuring the
 * tallies rather than the opinions. The total is shown from the start, because a
 * count of participants biases nothing and tells you whether the poll is alive.
 *
 * The bar is animated with `scaleX`, not `width`. Width is a layout property and
 * animating four of them per poll, several polls per screen, is exactly the kind
 * of thing that costs frames on the low-end Android this feed is tuned for.
 * `scaleX` stays on the compositor. The radius lives on the track, which clips
 * the fill, so scaling can't distort a rounded corner.
 */

type FeedPollProps = {
  options: string[];
  counts: number[];
  /** This viewer's option, 0-based, or null if they haven't voted. */
  choice: number | null;
  pending: boolean;
  onVote: (optionIndex: number) => void;
  reducedMotion: boolean;
};

function FeedPollBase({
  options,
  counts,
  choice,
  pending,
  onVote,
  reducedMotion,
}: FeedPollProps) {
  const voted = choice !== null;
  const total = counts.reduce((sum, value) => sum + (value || 0), 0);

  return (
    <div className="feed-poll mt-2.5" role="group" aria-label="Poll">
      {options.map((option, index) => {
        const count = counts[index] ?? 0;
        /* Guarded against a zero total rather than left to produce NaN, which
           renders as the literal string "NaN%" in a bar's label. */
        const share = total > 0 ? count / total : 0;
        const mine = choice === index;

        return (
          <button
            key={`${index}-${option}`}
            type="button"
            disabled={pending}
            aria-pressed={mine}
            onClick={() => {
              if (pending || mine) return;
              vibrate(HAPTIC.select);
              onVote(index);
            }}
            className={`feed-poll-option ${voted ? "is-resolved" : ""} ${mine ? "is-mine" : ""}`}
          >
            {voted && (
              <motion.span
                aria-hidden
                className="feed-poll-fill"
                initial={{ scaleX: 0 }}
                animate={{ scaleX: share }}
                transition={reducedMotion ? { duration: 0 } : spring.smooth}
              />
            )}

            <span className="feed-poll-label">
              {mine && (
                <span aria-hidden className="feed-poll-check">
                  <Check size={12} strokeWidth={3} />
                </span>
              )}
              <span className="truncate">{option}</span>
            </span>

            {voted && (
              <span className="feed-poll-share tabular-nums">
                {Math.round(share * 100)}%
              </span>
            )}
          </button>
        );
      })}

      <p className="feed-poll-total">
        {total === 0
          ? "No votes yet"
          : `${compactCount(total)} ${total === 1 ? "vote" : "votes"}`}
        {voted && " · you voted"}
        {/* Changing a vote is allowed server-side — the primary key upserts —
            so it is stated rather than left for someone to discover. */}
        {voted && " · tap another to change"}
      </p>
    </div>
  );
}

export const FeedPoll = memo(FeedPollBase);
export default FeedPoll;
