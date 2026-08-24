"use client";

import { memo, useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { FEED_SORTS, FEED_TOPICS, type FeedSort } from "@/lib/feed";
import { vibrate, HAPTIC } from "@/lib/haptics";

/**
 * The feed selector, laid out the way X lays it out.
 *
 * ONE ROW, NOT TWO
 *
 * This used to be a segmented pill for the four sorts with a second collapsible
 * row of nine topic chips underneath, plus a filter toggle to reveal it. Three
 * controls, two rows, and the same eight topics were *also* drawn inside the
 * composer — so the page opened with two nearly identical chip rows above the
 * first whisper.
 *
 * X solves this by refusing the distinction. "For you" and "Following" sit in the
 * same scroller as topic feeds because, to the person reading, they are all
 * answers to one question: which feed am I looking at. Sort-versus-filter is an
 * implementation detail, and exposing it as two separate axes made the reader do
 * the modelling. So the two collapse into one horizontal row with a single active
 * item and a sliding underline.
 *
 * Picking a sort clears the topic; picking a topic keeps the sort, so "Love"
 * stays ranked the way the reader last chose rather than silently reverting to
 * newest-first.
 *
 * WHY AN UNDERLINE AND NOT A FILLED PILL
 *
 * A filled indicator has to sit on a track, a track needs a background, and a
 * background is another rectangle competing with the posts. An underline is two
 * pixels. It is also the only indicator that reads correctly when the row scrolls
 * — a pill implies a bounded set of options, and this set runs off both edges.
 */

type FeedTabsProps = {
  sort: FeedSort;
  topic: string | null;
  onSortChange: (sort: FeedSort) => void;
  onTopicChange: (topic: string | null) => void;
  reducedMotion: boolean;
  /**
   * False on a database without the premium feed migration — the topic column
   * ships with it, so the topic tabs would every one of them return an empty
   * feed. The sorts stay, because `rankFeedPosts` can still order what it has.
   */
  showTopics?: boolean;
};

function FeedTabsBase({
  sort,
  topic,
  onSortChange,
  onTopicChange,
  reducedMotion,
  showTopics = true,
}: FeedTabsProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLButtonElement>(null);

  /* Keep the selection on screen. Selecting "Discussed" and then a topic tab
     leaves the active item off the right edge otherwise, which reads as having
     lost the selection entirely. `nearest` rather than `center` so an already
     visible tab does not make the row jump for no reason. */
  useEffect(() => {
    activeRef.current?.scrollIntoView({
      behavior: reducedMotion ? "auto" : "smooth",
      block: "nearest",
      inline: "nearest",
    });
  }, [sort, topic, reducedMotion]);

  const activeKey = topic ?? sort;

  const tabs: { key: string; label: string; select: () => void }[] = [
    ...FEED_SORTS.map((entry) => ({
      key: entry.key as string,
      label: entry.label,
      select: () => {
        onSortChange(entry.key);
        onTopicChange(null);
      },
    })),
    ...(showTopics
      ? FEED_TOPICS.map((entry) => ({
          key: entry.key,
          label: entry.label,
          /* Tapping the active topic returns to the sort it was filtering, which
             is the only way back that does not require finding "For You" again
             on a scrolled row. */
          select: () => onTopicChange(topic === entry.key ? null : entry.key),
        }))
      : []),
  ];

  return (
    <div className="feed-tabs-wrap">
      <div
        ref={scrollerRef}
        className="feed-tabs"
        role="tablist"
        aria-label="Choose a feed"
      >
        {tabs.map((tab) => {
          const active = tab.key === activeKey;
          return (
            <button
              key={tab.key}
              ref={active ? activeRef : undefined}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => {
                vibrate(HAPTIC.tap);
                tab.select();
              }}
              className={`feed-tab ${active ? "is-active" : ""}`}
            >
              {tab.label}
              {active && (
                /* `layoutId` rather than a computed translate: Framer measures
                   both positions itself, so the slide stays correct when the row
                   is mid-scroll — the case a hand-computed offset always gets
                   wrong. */
                <motion.span
                  layoutId="feed-tab-underline"
                  className="feed-tab-indicator"
                  aria-hidden
                  transition={
                    reducedMotion
                      ? { duration: 0 }
                      : { type: "spring", stiffness: 480, damping: 38, mass: 0.7 }
                  }
                />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export const FeedTabs = memo(FeedTabsBase);
export default FeedTabs;
