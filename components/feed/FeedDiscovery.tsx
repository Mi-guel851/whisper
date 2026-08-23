"use client";

import { memo } from "react";
import { motion } from "framer-motion";
import { Crown, Dices, Loader2, PenLine } from "lucide-react";
import { compactCount, shareExcerpt, type FeedPost } from "@/lib/feed";
import { vibrate, HAPTIC } from "@/lib/haptics";
import { spring } from "@/lib/motion";
import FeedQuestionSparks from "./FeedQuestionSparks";

/**
 * The discovery strip — the top of the retention loop.
 *
 * Three things, in the order they matter to somebody who just opened the app
 * with nothing particular in mind:
 *
 *   Daily Question    the same prompt for everyone, everywhere, for one UTC day.
 *                     It is the only control here that produces a post, which is
 *                     why it gets the headline treatment rather than a chip.
 *   Whisper of the Day the single most-engaged live post. Absent when nothing has
 *                     been engaged with yet — an empty spotlight would be a
 *                     trophy awarded for nothing.
 *   Surprise Me       a random eligible whisper, excluding everything already
 *                     shown this session.
 *
 * The strip is glass and the timeline below it is not. That is the app's rule
 * rather than a local choice: glass belongs to chrome, and forty blurred rows
 * would cost the compositor a re-blend on every frame of a scroll.
 */

type FeedDiscoveryProps = {
  question: string;
  spotlight: FeedPost | null;
  surprising: boolean;
  onAnswerQuestion: () => void;
  onOpenSpotlight: (post: FeedPost) => void;
  onSurprise: () => void;
  reducedMotion: boolean;
};

function FeedDiscoveryBase({
  question,
  spotlight,
  surprising,
  onAnswerQuestion,
  onOpenSpotlight,
  onSurprise,
  reducedMotion,
}: FeedDiscoveryProps) {
  const spotlightHeat =
    spotlight
      ? (spotlight.like_count ?? 0) + (spotlight.reply_count ?? 0)
      : 0;

  return (
    <section className="feed-discovery" aria-label="Discover">
      {/* Sits in the corner the radial glow already occupies, so the two read as
          one light source rather than two competing decorations. */}
      <FeedQuestionSparks />

      <div className="feed-discovery-head">
        <span className="feed-discovery-eyebrow">Today&apos;s question</span>
        <span className="feed-discovery-live" aria-hidden />
      </div>

      <p className="feed-discovery-question">{question}</p>

      <div className="feed-discovery-actions">
        <button
          type="button"
          onClick={() => {
            vibrate(HAPTIC.select);
            onAnswerQuestion();
          }}
          className="feed-discovery-answer"
        >
          <PenLine size={14} aria-hidden />
          Answer anonymously
        </button>

        <button
          type="button"
          onClick={() => {
            vibrate(HAPTIC.select);
            onSurprise();
          }}
          disabled={surprising}
          aria-label="Show me a random whisper"
          className="feed-discovery-surprise"
        >
          {surprising ? (
            <Loader2 size={14} className="animate-spin" aria-hidden />
          ) : (
            <motion.span
              aria-hidden
              className="inline-flex"
              /* One turn on press, not a loop. A permanently spinning die reads
                 as a loading state, and this button is idle most of the time. */
              whileTap={reducedMotion ? undefined : { rotate: 180 }}
              transition={spring.bouncy}
            >
              <Dices size={14} />
            </motion.span>
          )}
          Surprise me
        </button>
      </div>

      {spotlight && (
        <button
          type="button"
          onClick={() => {
            vibrate(HAPTIC.tap);
            onOpenSpotlight(spotlight);
          }}
          className="feed-spotlight"
        >
          <span className="feed-spotlight-badge">
            <Crown size={12} aria-hidden />
            Whisper of the day
          </span>
          <span className="feed-spotlight-body">{shareExcerpt(spotlight.body, 120)}</span>
          {spotlightHeat > 0 && (
            <span className="feed-spotlight-heat tabular-nums">
              {compactCount(spotlightHeat)} reactions
            </span>
          )}
        </button>
      )}
    </section>
  );
}

export const FeedDiscovery = memo(FeedDiscoveryBase);
export default FeedDiscovery;
