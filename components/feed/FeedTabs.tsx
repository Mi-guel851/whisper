"use client";

import { memo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { SlidersHorizontal } from "lucide-react";
import { FEED_SORTS, FEED_TOPICS, type FeedSort } from "@/lib/feed";
import { tween } from "@/lib/motion";
import { vibrate, HAPTIC } from "@/lib/haptics";

/**
 * The navigation above the timeline: what to rank by, and what to rank within.
 *
 * They are deliberately different shapes. The sorts are a *segmented control* —
 * four mutually exclusive views of the same feed, so they share one track and a
 * single indicator slides between them, which is the only affordance that says
 * "these four are one choice". The topics are *chips* — an optional filter that
 * can also be off, so they scroll, they can all be inactive, and "All" is a
 * first-class option rather than an implied default.
 *
 * WHY THE TOPICS COLLAPSE
 *
 * Nine chips is a row of permanent height above every post, and the composer
 * already shows the same eight topics — so on first paint the feed read as two
 * identical chip rows and a search box before a single whisper. Collapsing them
 * behind one control is the difference between a toolbar and a wall. The row
 * stays open on its own whenever a topic is actually applied: a hidden active
 * filter is how a feed ends up looking broken to the person who set it.
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
  const [filtersOpen, setFiltersOpen] = useState(false);
  const topicsVisible = showTopics && (filtersOpen || topic !== null);

  return (
    <div className="feed-tabs-wrap">
      <div className="feed-tabs-row">
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

        {showTopics && (
          <button
            type="button"
            onClick={() => {
              vibrate(HAPTIC.tap);
              /* Closing while a topic is applied clears it, because the row is
                 about to be hidden and leaving an invisible filter behind is
                 the one outcome nobody expects from a control like this. */
              if (topicsVisible && topic !== null) onTopicChange(null);
              setFiltersOpen((open) => !open);
            }}
            aria-expanded={topicsVisible}
            aria-label={topicsVisible ? "Hide topic filters" : "Filter by topic"}
            className={`feed-tabs-filter ${topicsVisible ? "is-active" : ""}`}
          >
            <SlidersHorizontal size={15} strokeWidth={2.2} />
            {topic !== null && <span className="feed-tabs-filter-dot" aria-hidden />}
          </button>
        )}
      </div>

      <AnimatePresence initial={false}>
        {topicsVisible && (
          /* Height animates on a wrapper so the scroller underneath keeps its
             own `overflow-x` — animating height directly on the scroll
             container would clip the chips mid-transition. */
          <motion.div
            key="topics"
            className="feed-topics-collapse"
            initial={reducedMotion ? { opacity: 0 } : { height: 0, opacity: 0 }}
            animate={reducedMotion ? { opacity: 1 } : { height: "auto", opacity: 1 }}
            exit={reducedMotion ? { opacity: 0 } : { height: 0, opacity: 0 }}
            transition={reducedMotion ? { duration: 0 } : tween.base}
          >
            {/* `overscroll-behavior-x: contain` on the class stops a horizontal
                flick here from becoming a browser back-navigation on Android. */}
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
                      /* Tapping the active chip clears it. Without this the only
                         way back to everything is to find "All" again, which on a
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
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export const FeedTabs = memo(FeedTabsBase);
export default FeedTabs;
