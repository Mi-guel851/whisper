"use client";

import { memo } from "react";
import { motion } from "framer-motion";
import { Feather } from "lucide-react";
import { spring } from "@/lib/motion";
import { vibrate, HAPTIC } from "@/lib/haptics";

/**
 * The compose button.
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
 * It sits above the bottom navigation rather than inside it: the nav is where you
 * go, this is what you do, and merging the two makes a five-item bar out of a
 * four-item one.
 *
 * A quill rather than a plus. X uses a plus at small sizes and a quill at large
 * ones for the same reason — a bare plus is the universal "add", which on a page
 * with a photo picker, a poll builder and a reply box is ambiguous. The quill says
 * "write" and nothing else.
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
      <Feather size={22} strokeWidth={2.4} aria-hidden />
    </motion.button>
  );
}

export const FeedFab = memo(FeedFabBase);
export default FeedFab;
