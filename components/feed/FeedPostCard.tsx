"use client";

import { memo } from "react";
import Link from "next/link";
import { Loader2, MoreHorizontal } from "lucide-react";
import { useAnonNames } from "@/lib/anonNames";
import {
  compactCount,
  countDescendants,
  timeAgo,
  topicMeta,
  type FeedPostNode,
} from "@/lib/feed";
import { isCreatorPost, OFFICIAL_IDENTITY } from "@/lib/creator";
import FeedAvatar from "./FeedAvatar";
import OfficialBadge from "./OfficialBadge";
import FeedActionBar from "./FeedActionBar";
import FeedReplyComposer from "./FeedReplyComposer";
import FeedImageWhisper from "./FeedImageWhisper";
import FeedPoll from "./FeedPoll";
import type { FeedController } from "./types";

/** Each reply branch expands independently; an open ancestor never opens siblings
 * or grandchildren. Indentation is capped for narrow screens. */

const AVATAR_ROOT = 42;
const AVATAR_REPLY = 34;

type FeedPostCardProps = {
  node: FeedPostNode;
  controller: FeedController;
  depth: number;
  /** Author of the post being answered — renders X's "Replying to" line. */
  parentAuthorId?: string;
  /** Whether that parent is an official post, so the line says "Whisper". */
  parentOfficial?: boolean;
  /** Ref callback that registers a root card for impression counting. */
  impressionRef?: (node: HTMLElement | null) => void;
  /**
   * The post a `?post=` share link pointed at, pulsed so the reader can find it.
   *
   * Threaded through the recursion rather than resolved to a boolean by the page,
   * because a shared link routinely points at a *reply* — and a page that can only
   * mark roots would scroll to the right post and then highlight nothing.
   */
  highlightId?: string | null;
};

function FeedPostCardBase({
  node,
  controller,
  depth,
  parentAuthorId,
  parentOfficial = false,
  impressionRef,
  highlightId = null,
}: FeedPostCardProps) {
  const isRoot = depth === 0;
  const highlighted = highlightId === node.id;
  const isMine = node.author_id === controller.myId;
  /* Decided from `author_role` as returned by the database, which refuses to
     store the creator value for anyone not on the server-side allowlist. Nothing
     the client holds can turn this on. */
  const official = isCreatorPost(node);
  /* Two ids per card, but requests inside the same commit coalesce into one
     query — so a whole thread costs one round trip, not one per post. */
  const nameOf = useAnonNames([node.author_id, parentAuthorId]);

  const likeCount = controller.likeCount[node.id] ?? node.like_count ?? 0;
  const liked = controller.liked[node.id] ?? node.viewer_liked ?? false;

  const children = node.children;
  const replyCount =
    children.length > 0 ? (isRoot ? countDescendants(node) : children.length) : node.reply_count ?? 0;
  const isReplyOpen = Boolean(controller.replyOpen[node.id]);
  const isExpanded = Boolean(controller.expanded[node.id]);
  const isThreadLoading = Boolean(controller.threadLoading[node.id]);
  const visibleChildren = isExpanded ? children : [];

  const topic = isRoot ? topicMeta(node.topic) : null;

  const pollOptions = node.poll_options;
  const pollCounts = controller.pollCounts[node.id] ?? node.poll_counts ?? [];
  const pollChoice = controller.pollChoice[node.id] ?? node.viewer_vote ?? null;

  const imageState =
    controller.imageState[node.id] ?? (node.viewer_image_viewed ? "spent" : "locked");

  /* The rail is drawn whenever something renders below this post in the same
     column — a reply, the composer that will become one, or the spinner that
     precedes them. */
  const hasRail = visibleChildren.length > 0 || isReplyOpen || isThreadLoading;

  // Unloaded branches still expose their server-provided reply count.
  const canToggleThread = replyCount > 0;

  /* X's reply gesture: open the thread when there is one, and bring the
     composer up with it. Idempotent on both halves, so a tap on an already-open
     post is a no-op rather than a surprise collapse. */
  const openConversation = () => {
    if (canToggleThread && !isExpanded) controller.onToggleThread(node.id);
    if (!isReplyOpen) controller.onToggleReplyBox(node.id);
  };

  return (
    <article
      ref={isRoot ? impressionRef : undefined}
      data-post-id={node.id}
      data-author-id={node.author_id}
      className={`${isRoot ? "feed-post" : "feed-post feed-post-reply"}${
        highlighted ? " is-highlighted" : ""
      }${official ? " feed-post-official" : ""}`}
    >
      <div className="flex gap-3">
        <div className="relative flex shrink-0 flex-col items-center">
          <FeedAvatar
            authorId={node.author_id}
            size={isRoot ? AVATAR_ROOT : AVATAR_REPLY}
            official={official}
          />
          {hasRail && <span aria-hidden className="feed-thread-rail" />}
        </div>

        <div className="min-w-0 flex-1 pb-0.5">
          <div className="feed-post-head">
            <span className="feed-author truncate font-black">
              {official ? OFFICIAL_IDENTITY.name : nameOf(node.author_id)}
            </span>
            {official && <OfficialBadge />}
            <span className="feed-dot shrink-0" aria-hidden>
              ·
            </span>
            <time
              dateTime={node.created_at}
              title={new Date(node.created_at).toLocaleString()}
              className="feed-time shrink-0 text-[13px] font-medium"
            >
              {timeAgo(node.created_at)}
            </time>
            {topic && (
              <span className="feed-topic-tag">
                <span aria-hidden>{topic.emoji}</span>
                {topic.label}
              </span>
            )}

            {/* X's overflow slot: in the header, at the far edge, where the
                thumb already goes for "what can I do with this post". It ends
                the header line instead of the action row, which is what lets
                that row be four evenly spaced counts. */}
            <button
              type="button"
              onClick={() => controller.onOpenMenu(node)}
              aria-label="More options"
              aria-haspopup="dialog"
              className="feed-head-more shrink-0"
            >
              <MoreHorizontal size={17} strokeWidth={2.4} />
            </button>
          </div>

          {/* X's orientation line for a reply that's been lifted out of its
              parent's immediate context. Only shown past the first level,
              where the rail alone no longer says who is being answered. */}
          {parentAuthorId && depth > 1 && (
            <p className="feed-replying-to mt-0.5 truncate text-[13px]">
              Replying to{" "}
              <span className="feed-replying-to-name font-bold">
                {parentOfficial ? OFFICIAL_IDENTITY.name : nameOf(parentAuthorId)}
              </span>
            </p>
          )}

          <p
            className={`feed-body mt-1 whitespace-pre-wrap break-words leading-normal ${
              isRoot ? "text-[15px]" : "text-[14px]"
            }`}
          >
            {node.body}
          </p>

          {node.has_image && (
            <FeedImageWhisper
              preview={node.image_preview ?? null}
              state={imageState}
              isAuthor={isMine}
              onOpen={() => controller.onOpenImage(node.id)}
            />
          )}

          {pollOptions && pollOptions.length >= 2 && (
            <FeedPoll
              options={pollOptions}
              counts={pollCounts}
              choice={pollChoice}
              pending={Boolean(controller.pollPending[node.id])}
              onVote={(optionIndex) => controller.onVote(node.id, optionIndex)}
              reducedMotion={controller.reducedMotion}
            />
          )}

          {/* Only root posts carry the author's Whisper link. Repeating it on
              every reply would turn a thread into a wall of identical CTAs. */}
          {isRoot && !official && node.whisper_link && (
            <Link href={node.whisper_link} className="feed-cta mt-2.5 block truncate">
              Send me an anonymous Whisper
            </Link>
          )}

          {/* Send state. A clock while the request is in flight, and a real
              Retry button if it failed — the post stays on screen either way,
              because silently removing something the author watched appear is
              worse than showing one that did not go through. */}
          {node.send_state && (
            <div
              className="mt-2 flex items-center gap-2 text-[11.5px] font-semibold"
              role={node.send_state === "failed" ? "alert" : "status"}
            >
              {node.send_state === "sending" ? (
                <>
                  <span className="h-2 w-2 animate-pulse rounded-full bg-purple-400/70" aria-hidden />
                  <span className="theme-text-muted">Posting…</span>
                </>
              ) : (
                <>
                  <span style={{ color: "var(--theme-error)" }}>Couldn&apos;t post</span>
                  <button
                    type="button"
                    onClick={() => controller.onRetryPost?.(node.id)}
                    className="underline underline-offset-2"
                    style={{ color: "var(--theme-error)" }}
                  >
                    Retry
                  </button>
                </>
              )}
            </div>
          )}

          <FeedActionBar
            replyCount={replyCount}
            likeCount={likeCount}
            viewCount={node.view_count ?? 0}
            liked={liked}
            active={isExpanded || isReplyOpen}
            onReply={openConversation}
            onLike={() => controller.onToggleLike(node.id)}
            onShare={() => controller.onShare(node)}
          />

          {isReplyOpen && (
            <FeedReplyComposer
              postId={node.id}
              value={controller.replyText[node.id] || ""}
              sending={Boolean(controller.replySending[node.id])}
              replyCost={controller.replyCost}
              onChange={controller.onReplyTextChange}
              onSend={controller.onRequestSend}
              onCancel={() => controller.onToggleReplyBox(node.id)}
            />
          )}
        </div>
      </div>

      {/* Fetching a thread is a round trip, and on a slow connection the tap
          would otherwise look ignored. */}
      {isThreadLoading && visibleChildren.length === 0 && (
        <div className="feed-thread-loading">
          <Loader2 size={14} className="animate-spin" aria-hidden />
          Loading {replyCount === 1 ? "reply" : "replies"}
        </div>
      )}

      {visibleChildren.length > 0 && (
        /* Indent once, then never again — see the note at the top of the file. */
        <div className={depth < 2 ? "feed-thread-children" : "feed-thread-branch"}>
          {/* X's marker between a post and its comments. The thread opens from
              the reply icon now, so something has to say where the post ends
              and the conversation begins — without it the first reply reads as
              a second paragraph of the post above it. */}
          {depth === 0 && <p className="feed-replies-divider">Showing replies</p>}

          {visibleChildren.map((child) => (
            <FeedPostCard
              key={child.id}
              node={child}
              controller={controller}
              depth={depth + 1}
              parentAuthorId={node.author_id}
              parentOfficial={official}
              highlightId={highlightId}
            />
          ))}

          {/* Closing from the bottom of a long thread saves scrolling back up
              to the reply icon that opened it. */}
          {isExpanded && (
            <button
              type="button"
              onClick={() => controller.onToggleThread(node.id)}
              className="feed-show-more"
            >
              Hide {compactCount(replyCount)} {replyCount === 1 ? "reply" : "replies"}
            </button>
          )}
        </div>
      )}
    </article>
  );
}

export const FeedPostCard = memo(FeedPostCardBase);
export default FeedPostCard;
