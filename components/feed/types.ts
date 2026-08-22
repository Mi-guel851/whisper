"use client";

import type { FeedPost } from "@/lib/feed";

/**
 * Everything a post card or comment needs from the feed page, bundled.
 *
 * Threads are recursive, so a comment three levels down needs the same
 * handlers the root card does. Passing them as one object keeps the recursion
 * readable instead of forwarding a dozen props at every level.
 *
 * WHY LIKES ARE COUNTS AND NOT ROWS
 *
 * This used to carry `likesByPost: Record<string, FeedLike[]>` and every card
 * derived both its total and its own state by scanning that array. That worked
 * while the feed downloaded every like row for every visible post, and it stops
 * working the moment the server does the counting: `public_feed_page` returns
 * `like_count` and `viewer_liked`, and the only way to feed those into an array
 * of rows is to invent rows nobody actually wrote. A synthesized like row is a
 * fake counter dressed as real activity.
 *
 * So the two facts a card needs are the two facts stored: how many, and whether
 * this viewer is one of them. The fallback path fills the same two maps from real
 * rows, so both paths render from identical state.
 */

/**
 * Lifecycle of a photo whisper, from this viewer's side.
 *
 *   locked       the blurred preview, one tap from being spent
 *   loading      the request is in flight
 *   spent        this viewer has had their look; it will not come back
 *   unavailable  expired, removed, or the server refused
 */
export type FeedImageState = "locked" | "loading" | "spent" | "unavailable";

export type FeedController = {
  myId: string;
  replyCost: number;
  /**
   * Resolved once by the page and carried down rather than read per card.
   * `useReducedMotion` in forty cards is forty subscriptions to one media query.
   */
  reducedMotion: boolean;

  /** Authoritative like totals, server-counted on the RPC path. */
  likeCount: Record<string, number>;
  /** Whether this viewer has liked each post. */
  liked: Record<string, boolean>;

  replyOpen: Record<string, boolean>;
  replyText: Record<string, string>;
  replySending: Record<string, boolean>;
  expanded: Record<string, boolean>;
  /** A thread whose replies are being fetched, so the card can say so. */
  threadLoading: Record<string, boolean>;

  /** Live tallies, replacing `poll_counts` once this viewer has voted. */
  pollCounts: Record<string, number[]>;
  /** This viewer's chosen option, 0-based. */
  pollChoice: Record<string, number>;
  /** A vote in flight, so the options can't be double-tapped into a race. */
  pollPending: Record<string, boolean>;

  /** Only holds posts whose state has changed since load; see `FeedImageState`. */
  imageState: Record<string, FeedImageState>;

  onToggleLike: (postId: string) => void;
  onToggleReplyBox: (postId: string) => void;
  onReplyTextChange: (postId: string, value: string) => void;
  onRequestSend: (postId: string) => void;
  /** Opens a closed thread, closes an open one. Threads start closed. */
  onToggleThread: (postId: string) => void;
  onRequestDelete: (postId: string) => void;
  onShare: (post: FeedPost) => void;
  onVote: (postId: string, optionIndex: number) => void;
  /** Spends this viewer's single look at a photo whisper. */
  onOpenImage: (postId: string) => void;
  /**
   * Opens the overflow sheet — copy link, share, report, block, delete.
   *
   * One handler rather than one per item, because the sheet itself is rendered
   * once at page level. A `Modal` inside every card would mean forty portals and
   * forty focus traps mounted to serve one that is open at a time.
   */
  onOpenMenu: (post: FeedPost) => void;
};
