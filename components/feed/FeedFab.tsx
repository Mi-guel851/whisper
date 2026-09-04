"use client";

import { memo } from "react";
import { motion } from "framer-motion";
import { Plus } from "lucide-react";
import { spring } from "@/lib/motion";
import { vibrate, HAPTIC } from "@/lib/haptics";

/**
 * The compose button — a plus, bottom-right, the way X does it.
 *
 * WHY A FLOATING BUTTON RATHER THAN THE COMPOSER ITSELF
 *
 * An always-open composer costs a fixed slab at the top of the feed — a textarea,
 * an avatar, a topic row, three tool buttons and a Post button — which is a lot of
 * screen for something most visits never touch. People open a feed to read; when
 * they do want to write, they want it immediately and from anywhere in the scroll.
 * A button that stays reachable the whole way down does that in one tap and costs
 * 56 pixels.
 *
 * WHY THE RIGHT CORNER, AND WHY A PLUS
 *
 * X parks its compose action as a plus floating above the bottom-right corner of
 * the timeline, and that is the corner the thumb owns — the same corner this now
 * uses. It used to sit on the left to keep clear of the Whispers AI button, but
 * the AI button is draggable and keeps clear of the bottom band on its own (see
 * WhispersAiAssistant's inset), so the right corner is free and matches the
 * gesture people already know.
 *
 * The glyph is a plus rather than a quill: on a page whose posts are text, photos
 * and polls, "add" is the honest verb, and it is the same glyph X uses at this
 * size. Whisper's gradient does the branding; the icon only has to say "make one".
 *
 * It sits above the bottom navigation rather than inside it: the nav is where you
 * go, this is what you do, and merging the two makes a five-item bar out of a
 * four-item one.
 */

type FeedFabProps = {
  onClick: () => void;
  /** Slides out of the way while a full-screen surface is up. */
  hidden?: boolean;
  reducedMotion: boolean;
};

function FeedFabBase({ onClick, hidden = false, reducedMotion }: FeedFabProps) {
  return (
    <motion.button
      type="button"
      onClick={() => {
        vibrate(HAPTIC.select);
        onClick();
      }}
      aria-label="Write a whisper"
      className="feed-fab"
      initial={reducedMotion ? false : { opacity: 0, scale: 0.6 }}
      animate={
        hidden
          ? { opacity: 0, scale: 0.85, pointerEvents: "none" }
          : { opacity: 1, scale: 1, pointerEvents: "auto" }
      }
      transition={reducedMotion ? { duration: 0.12 } : spring.snappy}
      whileTap={reducedMotion ? undefined : { scale: 0.92 }}
    >
      <Plus size={27} strokeWidth={2.6} aria-hidden />
    </motion.button>
  );
}

export const FeedFab = memo(FeedFabBase);
export default FeedFab;
