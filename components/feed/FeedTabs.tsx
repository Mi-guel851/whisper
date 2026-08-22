"use client";

import { memo } from "react";
import { motion } from "framer-motion";
import { FEED_SORTS, FEED_TOPICS, type FeedSort } from "@/lib/feed";
import { vibrate, HAPTIC } from "@/lib/haptics";

/**
 * The two rows of navigation above the timeline: what to rank by, and what to
 * rank within.
 *
 * They are deliberately different shapes. The sorts are a *segmented control* —
 * four mutually exclusive views of the same feed, so they share one track and a
 * single indicator slides between them, which is the only affordance that says
 * "these four are one choice". The topics are *chips* — an optional filter that
 * can also be off, so they scroll, they can all be inactive, and "All" is a
 * first-class option rather than an implied default.
 *
 * The indicator is a `layoutId` rather than a transform computed from offsets.
 * Framer measures both positions itself, which means the slide stays correct
 * when the labels reflow at a narrow width — the case a hand-computed translate
 * always gets wrong.
 */

type FeedTabsProps = {
  sort: FeedSort;
  topic: string | null;
  onSortChange: (sort: FeedSort) => void;
  onTopicChange: (topic: string | null) => void;
  /** Suppresses the layout animation for `prefers-reduced-motion`. */
  reducedMotion: boolean;
  /**
   * False on a database without the premium feed migration. The topic column
   * ships with it, so there is nothing to filter on there — and eight chips that
   * always return an empty feed are worse than no chips. The sorts stay, because
   * `rankFeedPosts` can still order the rows it has.
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
  return (
    <div className="feed-tabs-wrap">
      <div className="feed-tabs" role="tablist" aria-label="Sort the feed">
        {FEED_SORTS.map((entry) => {
          const active = entry.key === sort;
          return (
            <button
              key={entry.key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => {
                if (active) return;
                vibrate(HAPTIC.tap);
                onSortChange(entry.key);
              }}
              className={`feed-tab ${active ? "is-active" : ""}`}
            >
              {active && (
                <motion.span
                  layoutId="feed-tab-indicator"
                  className="feed-tab-indicator"
                  aria-hidden
                  transition={
                    reducedMotion
                      ? { duration: 0 }
                      : { type: "spring", stiffness: 460, damping: 36, mass: 0.8 }
                  }
                />
              )}
              <span className="relative z-[1]">{entry.label}</span>
            </button>
          );
        })}
      </div>

      {/* `overscroll-behavior-x: contain` on the class stops a horizontal flick
          here from becoming a browser back-navigation on Android. */}
      {showTopics && (
        <div className="feed-topics" role="group" aria-label="Filter by topic">
          <button
            type="button"
            aria-pressed={topic === null}
            onClick={() => {
              vibrate(HAPTIC.tap);
              onTopicChange(null);
            }}
            className={`feed-topic-chip ${topic === null ? "is-active" : ""}`}
          >
            All
          </button>

          {FEED_TOPICS.map((entry) => {
            const active = topic === entry.key;
            return (
              <button
                key={entry.key}
                type="button"
                aria-pressed={active}
                onClick={() => {
                  vibrate(HAPTIC.tap);
                  /* Tapping the active chip clears it. Without this the only way
                     back to everything is to find "All" again, which on a
                     scrolled row can be off-screen. */
                  onTopicChange(active ? null : entry.key);
                }}
                className={`feed-topic-chip ${active ? "is-active" : ""}`}
              >
                <span aria-hidden className="feed-topic-emoji">
                  {entry.emoji}
                </span>
                {entry.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export const FeedTabs = memo(FeedTabsBase);
export default FeedTabs;
