"use client";

import type { FeedLike } from "@/lib/feed";

/**
 * Everything a post card or comment needs from the feed page, bundled.
 *
 * Threads are recursive, so a comment three levels down needs the same
 * handlers the root card does. Passing them as one object keeps the recursion
 * readable instead of forwarding a dozen props at every level.
 */
export type FeedController = {
  myId: string;
  replyCost: number;
  likesByPost: Record<string, FeedLike[]>;
  replyOpen: Record<string, boolean>;
  replyText: Record<string, string>;
  replySending: Record<string, boolean>;
  expanded: Record<string, boolean>;
  onToggleLike: (postId: string) => void;
  onToggleReplyBox: (postId: string) => void;
  onReplyTextChange: (postId: string, value: string) => void;
  onRequestSend: (postId: string) => void;
  /** Opens a closed thread, closes an open one. Threads start closed. */
  onToggleThread: (postId: string) => void;
  onRequestDelete: (postId: string) => void;
  onShare: (postId: string, body: string, whisperLink: string) => void;
};
