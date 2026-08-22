"use client";

/**
 * Row-shaped placeholders, so the timeline doesn't reflow when posts land.
 *
 * Deliberately not glass and deliberately not card-shaped: the skeleton has to
 * occupy the same silhouette as a `.feed-post` row or the first paint after
 * loading jumps. It also stops at three rows — a full screen of shimmer reads as
 * a broken page rather than a loading one, and only the top of the list is
 * visible while it's on screen anyway.
 */

type FeedSkeletonProps = {
  /** Fewer for the "loading more" sentinel than for a cold start. */
  rows?: number;
};

export default function FeedSkeleton({ rows = 3 }: FeedSkeletonProps) {
  return (
    <div aria-hidden>
      {Array.from({ length: rows }, (_, row) => (
        <div key={row} className="feed-post flex gap-3">
          <div className="skeleton h-[42px] w-[42px] shrink-0 rounded-full" />
          <div className="min-w-0 flex-1 space-y-2 pt-1">
            <div className="skeleton h-3 w-32 rounded-full" />
            <div className="skeleton h-3 w-full rounded-full" />
            <div className="skeleton h-3 w-4/5 rounded-full" />
            <div className="skeleton mt-3 h-8 w-full rounded-2xl" />
          </div>
        </div>
      ))}
    </div>
  );
}
