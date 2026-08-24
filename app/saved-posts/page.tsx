"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { Bookmark, BookmarkX } from "lucide-react";

import BackButton from "@/components/BackButton";
import BottomNavigation from "@/components/BottomNavigation";
import EmptyState from "@/components/ui/EmptyState";
import FeedPostCard from "@/components/feed/FeedPostCard";
import FeedSkeleton from "@/components/feed/FeedSkeleton";
import FeedPhotoViewer from "@/components/feed/FeedPhotoViewer";
import FeedShareSheet, { feedPostUrl } from "@/components/feed/FeedShareSheet";
import type { FeedController, FeedImageState } from "@/components/feed/types";
import { useToast } from "@/components/ToastProvider";
import { supabase } from "@/lib/supabase/client";
import { buildPostTree, type FeedPost, type FeedPostNode } from "@/lib/feed";
import { fetchSavedPosts, toggleSave, type SavedPost } from "@/lib/feedApi";
import { FEED_REPLY_COST } from "@/lib/coins";
import { useSafeReducedMotion } from "@/lib/useSafeReducedMotion";
import { tween } from "@/lib/motion";
import { vibrate, HAPTIC } from "@/lib/haptics";

/**
 * Saved posts.
 *
 * WHAT THIS PAGE IS
 *
 * The whispers you bookmarked, newest save first, rendered with the feed's own
 * `FeedPostCard` so a saved post looks exactly like the post you saved — same
 * avatar, same topic tag, same photo and poll treatment. A second, simpler card for
 * this screen would have meant two components drifting apart on every change to
 * either, and a saved copy that does not resemble the original is a quietly broken
 * feature.
 *
 * WHY SAVES CAN VANISH, AND WHY THAT IS CORRECT
 *
 * The feed expires posts 24 hours after they are written, and a save is a pointer
 * rather than a copy — so a saved whisper disappears when the original does. That is
 * the promise the whole product rests on: nothing in the feed outlives a day. A
 * Saved tab that resurrected other people's expired confessions would be the one
 * place the app broke its own rule. The subtitle says so up front, so a vanished
 * save reads as the design rather than as data loss.
 *
 * WHY THE CONTROLLER IS MOSTLY INERT
 *
 * `FeedPostCard` takes a `FeedController` — the page-level object that owns likes,
 * replies, polls and threads for the live feed. Almost none of that applies here:
 * this is a reading surface, and the actions that change a post belong on the post,
 * in the feed. So liking, replying and voting route the reader back to the whisper
 * itself rather than being reimplemented against a second set of state that could
 * disagree with the feed's. Photo viewing and Share do work, because both are local
 * to the act of looking at something.
 */

/* One frozen object for every empty map the controller needs. A fresh `{}` per field
   per render would give `FeedPostCard`'s `memo` a new controller every time. */
const EMPTY_MAP: Record<string, never> = {};

export default function SavedPostsPage() {
  const { showToast } = useToast();
  const reducedMotion = useSafeReducedMotion();

  const [myId, setMyId] = useState("");
  const [rows, setRows] = useState<SavedPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [available, setAvailable] = useState(true);

  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [sharePost, setSharePost] = useState<FeedPost | null>(null);
  const [imageState, setImageState] = useState<Record<string, FeedImageState>>({});

  /* Mirrors `imageState` for the async handler, so it can read the current value
     without being re-created every time one photo changes state. */
  const imageStateRef = useRef<Record<string, FeedImageState>>({});

  /* Guards a slow response resolving after the reader has left. */
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  const load = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      if (alive.current) setLoading(false);
      return;
    }
    if (alive.current) setMyId(session.user.id);

    try {
      const result = await fetchSavedPosts(0, 30);
      if (!alive.current) return;

      if (result.mode === "unavailable") {
        setAvailable(false);
        return;
      }
      setRows(result.rows);
    } catch (error) {
      console.error(error);
      if (alive.current) showToast("Couldn't load your saved whispers.");
    } finally {
      if (alive.current) setLoading(false);
    }
  }, [showToast]);

  useEffect(() => { void load(); }, [load]);

  /*
   * Unsaving removes the row immediately.
   *
   * On this screen the list *is* the set of saves, so leaving an unsaved post on
   * screen would be showing something that is no longer there. Put back on failure —
   * losing a save to a timed-out request is worse than a moment's flicker.
   */
  const unsave = useCallback(
    async (post: FeedPost) => {
      vibrate(HAPTIC.tap);
      const removed = rows.find((row) => row.id === post.id);
      setRows((current) => current.filter((row) => row.id !== post.id));

      try {
        const nowSaved = await toggleSave(post.id);
        if (nowSaved) {
          /* It was not actually saved, and now is. Put it back rather than leave the
             list disagreeing with the database. */
          if (removed) setRows((current) => [removed, ...current]);
          return;
        }
        showToast("Removed from saved.");
      } catch (error) {
        console.error(error);
        if (removed) setRows((current) => [removed, ...current]);
        showToast("Couldn't remove that. Try again.");
      }
    },
    [rows, showToast]
  );

  /* Saved rows are roots as far as this page is concerned. A saved reply is shown on
     its own terms rather than with a thread it has no context for here. */
  const nodes = useMemo<FeedPostNode[]>(
    () => buildPostTree(rows as FeedPost[]),
    [rows]
  );

  /*
   * The same single-look rule as the feed, and the same endpoint: POST with a
   * `postId`, and the response is the image bytes rather than a URL. The server owns
   * the accounting, so this cannot be the place that gets it wrong.
   */
  const openImage = useCallback(
    async (postId: string) => {
      if (imageStateRef.current[postId] === "loading") return;

      const post = rows.find((row) => row.id === postId);
      const isAuthor = Boolean(post && post.author_id === myId);
      const current =
        imageStateRef.current[postId] ?? (post?.viewer_image_viewed ? "spent" : "locked");
      if (!isAuthor && (current === "spent" || current === "unavailable")) return;

      const set = (state: FeedImageState) => {
        imageStateRef.current = { ...imageStateRef.current, [postId]: state };
        setImageState(imageStateRef.current);
      };

      set("loading");
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) { showToast("Login required"); set("locked"); return; }

        const res = await fetch("/api/feed/photo", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ postId }),
        });

        if (!res.ok) {
          const json = await res.json().catch(() => ({} as { error?: string }));
          showToast(json.error || "Couldn't open that photo.");
          set(res.status === 410 ? "spent" : res.status === 404 ? "unavailable" : "locked");
          return;
        }

        const blob = await res.blob();
        setPhotoUrl(URL.createObjectURL(blob));
        set(isAuthor ? "locked" : "spent");
        vibrate(HAPTIC.tap);
      } catch (error) {
        console.error(error);
        showToast("Network error");
        set("locked");
      }
    },
    [rows, myId, showToast]
  );

  const closePhoto = useCallback(() => {
    setPhotoUrl((current) => {
      /* Revoked rather than left to the GC: these are object URLs over image bytes,
         and a session of browsing photos would otherwise hold every one in memory. */
      if (current) URL.revokeObjectURL(current);
      return null;
    });
  }, []);

  /* Anything that changes a post belongs on the post, in the feed. These send the
     reader to the whisper rather than duplicating its state here. */
  const openInFeed = useCallback((postId: string) => {
    window.location.href = `/public-feed?post=${encodeURIComponent(postId)}`;
  }, []);

  const controller: FeedController = useMemo(
    () => ({
      myId,
      replyCost: FEED_REPLY_COST,
      reducedMotion,
      likeCount: EMPTY_MAP,
      liked: EMPTY_MAP,
      replyOpen: EMPTY_MAP,
      replyText: EMPTY_MAP,
      replySending: EMPTY_MAP,
      expanded: EMPTY_MAP,
      threadLoading: EMPTY_MAP,
      pollCounts: EMPTY_MAP,
      pollChoice: EMPTY_MAP,
      pollPending: EMPTY_MAP,
      imageState,
      onToggleLike: openInFeed,
      onToggleReplyBox: openInFeed,
      onReplyTextChange: () => {},
      onRequestSend: () => {},
      onToggleThread: openInFeed,
      onRequestDelete: openInFeed,
      onShare: setSharePost,
      onVote: (postId) => openInFeed(postId),
      onOpenImage: (postId) => void openImage(postId),
      /* The overflow sheet is the feed's. The one action that makes sense here is
         unsaving, and the bookmark on the row does that directly. */
      onOpenMenu: (post) => void unsave(post),
    }),
    [myId, reducedMotion, imageState, openInFeed, openImage, unsave]
  );

  const copyLink = useCallback(
    async (post: FeedPost) => {
      try {
        await navigator.clipboard.writeText(feedPostUrl(post.id));
        showToast("Link copied.");
      } catch {
        showToast("Couldn't copy that link.");
      }
    },
    [showToast]
  );

  return (
    <main className="min-h-screen theme-bg-gradient pb-28">
      <div className="saved-shell">
        <header className="saved-head">
          <BackButton />

          <div className="saved-title-row">
            <span aria-hidden className="saved-title-badge">
              <Bookmark size={16} strokeWidth={2.4} />
            </span>
            <div className="min-w-0">
              <h1 className="saved-title">Saved posts</h1>
              <p className="saved-subtitle">
                Whispers you kept. They disappear when the original does — the feed
                only holds 24 hours.
              </p>
            </div>
          </div>
        </header>

        {loading ? (
          <FeedSkeleton />
        ) : !available ? (
          <EmptyState
            icon={<BookmarkX size={26} />}
            title="Saving isn't set up yet"
            description="This server is missing the saved-posts migration. Apply it and the whispers you save will appear here."
            action={{ label: "Open the feed", href: "/public-feed" }}
          />
        ) : nodes.length === 0 ? (
          <EmptyState
            icon={<BookmarkX size={26} />}
            title="Nothing saved yet"
            description="Open the menu on any whisper and choose Save. It stays here for as long as the whisper lives."
            action={{ label: "Open the feed", href: "/public-feed" }}
          />
        ) : (
          <section className="saved-list" aria-label="Saved whispers">
            <AnimatePresence initial={false}>
              {nodes.map((node) => (
                <motion.article
                  key={node.id}
                  layout={!reducedMotion}
                  exit={reducedMotion ? { opacity: 0 } : { opacity: 0, x: -24 }}
                  transition={tween.base}
                  className="saved-row"
                >
                  <FeedPostCard node={node} controller={controller} depth={0} />

                  {/* One action per row, on the row. A single-item overflow sheet
                      would be a menu for its own sake. */}
                  <div className="saved-row-actions">
                    <button
                      type="button"
                      onClick={() => void unsave(node)}
                      aria-label="Remove from saved"
                      className="saved-remove"
                    >
                      <Bookmark size={14} strokeWidth={2.4} fill="currentColor" aria-hidden />
                      Saved
                    </button>

                    <Link
                      href={`/public-feed?post=${encodeURIComponent(node.id)}`}
                      className="saved-open"
                    >
                      Open in feed
                    </Link>
                  </div>
                </motion.article>
              ))}
            </AnimatePresence>
          </section>
        )}
      </div>

      <FeedShareSheet
        post={sharePost}
        onClose={() => setSharePost(null)}
        onCopy={(post) => void copyLink(post)}
      />

      <FeedPhotoViewer src={photoUrl} onClose={closePhoto} />

      <BottomNavigation />
    </main>
  );
}
