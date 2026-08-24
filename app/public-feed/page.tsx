"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowUp, MessageSquareDashed, SearchX } from "lucide-react";
import BottomNavigation from "@/components/BottomNavigation";
import ConfirmDialog from "@/components/ConfirmDialog";
import EmptyState from "@/components/ui/EmptyState";
import FeedPostCard from "@/components/feed/FeedPostCard";
import FeedTabs from "@/components/feed/FeedTabs";
import FeedTopBar from "@/components/feed/FeedTopBar";
import FeedDrawer from "@/components/feed/FeedDrawer";
import FeedFab from "@/components/feed/FeedFab";
import FeedSearchBar from "@/components/feed/FeedSearchBar";
import FeedComposerSheet from "@/components/feed/FeedComposerSheet";
import { type ComposerDraft } from "@/components/feed/FeedComposer";
import FeedSkeleton from "@/components/feed/FeedSkeleton";
import FeedPhotoViewer from "@/components/feed/FeedPhotoViewer";
import FeedPostMenu from "@/components/feed/FeedPostMenu";
import FeedShareSheet, { feedPostUrl } from "@/components/feed/FeedShareSheet";
import FeedReportSheet from "@/components/feed/FeedReportSheet";
import type { FeedController, FeedImageState } from "@/components/feed/types";
import { supabase } from "@/lib/supabase/client";
import { useToast } from "@/components/ToastProvider";
import {
  buildPostTree,
  dailyQuestionFor,
  rankFeedPosts,
  type FeedLike,
  type FeedPost,
  type FeedPostNode,
  type FeedSort,
  type FeedTopic,
} from "@/lib/feed";
import {
  FEED_PAGE_SIZE,
  blockAuthor,
  fetchFeedPage,
  fetchLikes,
  fetchPostById,
  fetchRandomPost,
  fetchSpotlight,
  fetchThread,
  reportPost,
  votePoll,
  type FeedQuery,
  type ReportReason,
} from "@/lib/feedApi";
import { FEED_POST_COST, FEED_REPLY_COST } from "@/lib/coins";
import { requireOnline, isOnline } from "@/lib/offline";
import { useAnonNames } from "@/lib/anonNames";
import { tween } from "@/lib/motion";
import useSafeReducedMotion from "@/lib/useSafeReducedMotion";
import useHideOnScroll from "@/lib/useHideOnScroll";
import { vibrate, HAPTIC } from "@/lib/haptics";

/**
 * The Public Feed.
 *
 * This page is the orchestrator and almost nothing else: the timeline, the
 * composer, the discovery strip, the sheets and the photo viewer are all their
 * own components under components/feed/, and everything that talks to Supabase
 * lives in lib/feedApi. What is left here is the state those pieces share and the
 * handful of decisions that only make sense at page level.
 *
 * TWO READ PATHS, ONE RENDER
 *
 * On a database with the premium feed migration, `public_feed_page` does the
 * ranking, filtering, counting and blocking in one round trip and this page
 * paginates it ten roots at a time. Without that migration the page falls back to
 * the original whole-window table read and does the same work in the browser via
 * `rankFeedPosts`, paginating the array instead of the query. `mode` says which
 * one is live. Both fill the same state, so the components below never branch.
 *
 * WHY THE SHEETS LIVE HERE
 *
 * One overflow sheet, one share sheet, one report sheet, one photo viewer — each
 * mounted once and pointed at whichever post was tapped. A `Modal` inside every
 * card would mean forty portals and forty focus traps to serve the one that is
 * open.
 *
 * WHAT IS OPTIMISTIC AND WHAT IS NOT
 *
 * Likes are optimistic, because a like is a fact the client already knows: it is
 * my own row and the count moves by exactly one. Poll tallies are not, because a
 * total is only knowable server-side — so the option shows a pending state and
 * the real counts arrive with the response. Guessing at them would put a number
 * on screen that nobody wrote.
 */

/* Replies are free and posting is what costs — see lib/coins.ts for why. */

/**
 * Strips `image_path` and settles `has_image`.
 *
 * Realtime payloads carry every column of the inserted row, including the
 * storage key, and there is no reason for that key to sit in client state: the
 * bytes come from /api/feed/photo by post id. `has_image` is derived where it is
 * absent, which is exact — the API route refuses a photo without a preview, so
 * "has a preview" and "has a photo" are the same fact.
 */
function sanitize(row: FeedPost): FeedPost {
  const copy: Record<string, unknown> = { ...row };
  delete copy.image_path;
  copy.has_image = row.has_image ?? Boolean(row.image_preview);
  return copy as unknown as FeedPost;
}

/** Merges rows by id, keeping fields the incoming row doesn't carry. */
function mergeRows(current: FeedPost[], incoming: FeedPost[]): FeedPost[] {
  if (!incoming.length) return current;
  const byId = new Map(current.map((post) => [post.id, post]));
  for (const row of incoming) {
    const existing = byId.get(row.id);
    byId.set(row.id, existing ? { ...existing, ...row } : row);
  }
  return Array.from(byId.values());
}

export default function PublicFeedPage() {
  const { showToast } = useToast();
  /* Resolved once here and passed down through the controller. Forty cards each
     subscribing to the same media query is forty listeners for one boolean.

     `useSafeReducedMotion` rather than Framer's `useReducedMotion`: this value
     decides `initial` transforms and whether decorative elements mount at all, so
     reading the media query during the hydration render — which is what Framer's
     hook does — disagrees with the server HTML and throws the whole tree away for
     exactly the users who asked for less work. See lib/useSafeReducedMotion.ts. */
  const reducedMotion = useSafeReducedMotion();

  const [myId, setMyId] = useState("");
  const [username, setUsername] = useState("");
  const [ready, setReady] = useState(false);

  const [sort, setSort] = useState<FeedSort>("for_you");
  const [topic, setTopic] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  /* Search is a control, not a permanent row. Collapsed by default so the first
     paint is the feed rather than a stack of chrome; forced open whenever a term
     is applied, so the box that owns the filter is always the box you can see. */
  const [searchOpen, setSearchOpen] = useState(false);

  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [rootOrder, setRootOrder] = useState<string[]>([]);
  const [mode, setMode] = useState<"rpc" | "fallback" | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [visibleCount, setVisibleCount] = useState(FEED_PAGE_SIZE);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  const [likeCount, setLikeCount] = useState<Record<string, number>>({});
  const [liked, setLiked] = useState<Record<string, boolean>>({});
  const [likeRows, setLikeRows] = useState<FeedLike[]>([]);

  const [replyOpen, setReplyOpen] = useState<Record<string, boolean>>({});
  const [replyTextMap, setReplyTextMap] = useState<Record<string, string>>({});
  const [replySendingMap, setReplySendingMap] = useState<Record<string, boolean>>({});
  const [expandedThreads, setExpandedThreads] = useState<Record<string, boolean>>({});
  const [threadLoading, setThreadLoading] = useState<Record<string, boolean>>({});

  const [pollCounts, setPollCounts] = useState<Record<string, number[]>>({});
  const [pollChoice, setPollChoice] = useState<Record<string, number>>({});
  const [pollPending, setPollPending] = useState<Record<string, boolean>>({});

  const [imageState, setImageState] = useState<Record<string, FeedImageState>>({});
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);

  const [menuPost, setMenuPost] = useState<FeedPost | null>(null);
  const [sharePost, setSharePost] = useState<FeedPost | null>(null);
  const [reportTarget, setReportTarget] = useState<FeedPost | null>(null);
  const [reporting, setReporting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const [spotlight, setSpotlight] = useState<FeedPost | null>(null);
  const [surprising, setSurprising] = useState(false);
  const [highlight, setHighlight] = useState<string | null>(null);
  const [pendingNew, setPendingNew] = useState<string[]>([]);

  const [prefillNonce, setPrefillNonce] = useState(0);
  const [prefillBody, setPrefillBody] = useState("");
  const [prefillTopic, setPrefillTopic] = useState<FeedTopic | null>(null);
  const [prefillPoll, setPrefillPoll] = useState(false);

  /* The two surfaces the X layout replaces the old stacked chrome with. Both are
     page state rather than component state because more than one control opens
     each: the avatar and the attention dot both open the drawer, and the FAB, the
     empty state, the Daily Question and the drawer's poll row all open the
     composer. */
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);

  /*
   * The top bar retracts on the way down the timeline and comes back the moment
   * the reader turns around, leaving the tab row as the top edge. See
   * lib/useHideOnScroll.ts for the gesture handling.
   *
   * The hook reports scroll direction only; the exceptions are composed here.
   * Search, because the field's toggle lives *in* the bar — retracting it hides
   * the only way to close a filter that is currently emptying the feed. The
   * drawer and the composer, so momentum still in flight when a surface opens
   * cannot finish retracting the bar behind it, which would leave it missing on
   * dismiss. Reduced motion is the hook's own `enabled`, since that one is
   * permanent for the session rather than a passing state.
   */
  const scrolledAway = useHideOnScroll({ enabled: !reducedMotion });
  const chromeHidden = scrolledAway && !searchOpen && !drawerOpen && !composerOpen;

  /* Whether this user has already answered today's question, so the drawer button
     only carries a dot while there is genuinely something new behind it. Derived
     from what is already loaded — no extra query — by looking for one of their own
     posts on today's question topic since the question rolled over at 00:00 UTC. */
  const answeredToday = useMemo(() => {
    if (!myId) return false;
    const dayStart = new Date();
    dayStart.setUTCHours(0, 0, 0, 0);
    const cutoff = dayStart.getTime();
    return posts.some(
      (post) =>
        post.author_id === myId &&
        post.topic === "question" &&
        new Date(post.created_at).getTime() >= cutoff
    );
  }, [posts, myId]);

  const ownLink = username ? `/u/${username}` : "";
  /* One id, so this is a cache read in every case but the first. The drawer shows
     the poster their own generated identity — the same one their posts carry, which
     is the only name that means anything on an anonymous feed. */
  const anonName = useAnonNames([myId]);
  const dailyQuestion = useMemo(() => dailyQuestionFor(), []);
  const query = useMemo<FeedQuery>(() => ({ sort, topic, search }), [sort, topic, search]);

  /* ---------------------------------------------------------------------
     Synchronous mirrors. Handlers read these instead of state so a tap
     resolves against the current value rather than the one from the render
     that created the closure.
     --------------------------------------------------------------------- */
  const myIdRef = useRef("");
  const postsRef = useRef<FeedPost[]>([]);
  const likedRef = useRef<Record<string, boolean>>({});
  const expandedRef = useRef<Record<string, boolean>>({});
  const modeRef = useRef<"rpc" | "fallback" | null>(null);
  const threadsLoaded = useRef<Set<string>>(new Set());
  const imageStateRef = useRef<Record<string, FeedImageState>>({});
  const pollPendingRef = useRef<Record<string, boolean>>({});
  const seenRandom = useRef<string[]>([]);
  const noticeShown = useRef(false);
  /* The query, mirrored for the same reason: the realtime handler is created
     once and must not decide whether a new post may be prepended by consulting
     the sort that was active when it subscribed. */
  const sortRef = useRef(sort);
  const topicRef = useRef(topic);
  const searchRef = useRef(search);

  useEffect(() => { myIdRef.current = myId; }, [myId]);
  useEffect(() => { postsRef.current = posts; }, [posts]);
  useEffect(() => { likedRef.current = liked; }, [liked]);
  useEffect(() => { expandedRef.current = expandedThreads; }, [expandedThreads]);
  useEffect(() => { modeRef.current = mode; }, [mode]);
  useEffect(() => { imageStateRef.current = imageState; }, [imageState]);
  useEffect(() => { pollPendingRef.current = pollPending; }, [pollPending]);
  useEffect(() => { sortRef.current = sort; }, [sort]);
  useEffect(() => { topicRef.current = topic; }, [topic]);
  useEffect(() => { searchRef.current = search; }, [search]);

  /* ---------------------------------------------------------------------
     Impressions — batched so a fast scroll doesn't fire one request per card.
     --------------------------------------------------------------------- */
  const pendingImpressions = useRef<Set<string>>(new Set());
  const recordedImpressions = useRef<Set<string>>(new Set());
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flushImpressions = useCallback(async () => {
    const batch = Array.from(pendingImpressions.current);
    pendingImpressions.current.clear();
    if (!batch.length) return;

    /* Held rather than spent while offline. These are real views — the reader is
       looking at cached posts — so putting them back means they are counted once
       on reconnect instead of thrown away by a request that cannot succeed. The
       set is bounded by the size of the loaded feed, so it cannot grow without
       limit. */
    if (!isOnline()) {
      for (const id of batch) pendingImpressions.current.add(id);
      return;
    }

    const { error } = await supabase.rpc("record_public_feed_impressions", { post_ids: batch });
    if (error) {
      // Migration may not be applied yet — degrade silently, the counter stays put.
      console.warn("Impression recording skipped:", error.message);
      return;
    }

    setPosts((current) =>
      current.map((post) =>
        batch.includes(post.id) ? { ...post, view_count: (post.view_count ?? 0) + 1 } : post
      )
    );
  }, []);

  const trackImpression = useCallback((postId: string, authorId: string) => {
    if (!myIdRef.current || authorId === myIdRef.current) return;
    if (recordedImpressions.current.has(postId)) return;

    recordedImpressions.current.add(postId);
    pendingImpressions.current.add(postId);

    if (flushTimer.current) clearTimeout(flushTimer.current);
    flushTimer.current = setTimeout(() => { void flushImpressions(); }, 900);
  }, [flushImpressions]);

  useEffect(() => {
    return () => { if (flushTimer.current) clearTimeout(flushTimer.current); };
  }, []);

  // A single observer for every root card, so a long feed costs one observer.
  const observer = useRef<IntersectionObserver | null>(null);
  const observedNodes = useRef<Set<HTMLElement>>(new Set());
  const trackRef = useRef(trackImpression);
  useEffect(() => { trackRef.current = trackImpression; }, [trackImpression]);

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;

    const instance = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const node = entry.target as HTMLElement;
          const { postId, authorId } = node.dataset;
          if (postId && authorId) {
            trackRef.current(postId, authorId);
            instance.unobserve(node);
            observedNodes.current.delete(node);
          }
        }
      },
      { threshold: 0.5 }
    );

    observer.current = instance;
    observedNodes.current.forEach((node) => instance.observe(node));

    return () => { instance.disconnect(); observer.current = null; };
  }, []);

  const impressionRef = useCallback((node: HTMLElement | null) => {
    if (!node) return;
    observedNodes.current.add(node);
    observer.current?.observe(node);
  }, []);

  /* ---------------------------------------------------------------------
     Reading the feed
     --------------------------------------------------------------------- */

  /** Seeds the like maps so an optimistic toggle has a real base to move from. */
  const seedLikes = useCallback((rows: FeedPost[]) => {
    setLikeCount((current) => {
      let changed = false;
      const next = { ...current };
      for (const row of rows) {
        if (typeof row.like_count === "number" && next[row.id] !== row.like_count) {
          next[row.id] = row.like_count;
          changed = true;
        }
      }
      return changed ? next : current;
    });
    setLiked((current) => {
      let changed = false;
      const next = { ...current };
      for (const row of rows) {
        if (typeof row.viewer_liked === "boolean" && next[row.id] !== row.viewer_liked) {
          next[row.id] = row.viewer_liked;
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, []);

  const loadPage = useCallback(
    async (offset: number, replace: boolean) => {
      const response = await fetchFeedPage(query, offset);

      if (response.mode === "rpc") {
        const rows = response.rows.map(sanitize);
        setMode("rpc");
        setPosts((current) => (replace ? rows : mergeRows(current, rows)));
        setRootOrder((current) => {
          const ids = rows.map((row) => row.id);
          if (replace) return ids;
          const seen = new Set(current);
          return [...current, ...ids.filter((id) => !seen.has(id))];
        });
        setHasMore(response.hasMore);
        seedLikes(rows);
        if (replace) threadsLoaded.current.clear();
        return;
      }

      /* The whole live window in one response. Pagination becomes a slice, so a
         "load more" on this path never touches the network again. */
      const rows = response.rows.map(sanitize);
      setMode("fallback");
      setPosts(rows);
      setRootOrder([]);
      setVisibleCount(FEED_PAGE_SIZE);
      setHasMore(false);
      threadsLoaded.current.clear();

      if (!noticeShown.current) {
        noticeShown.current = true;
        showToast(
          response.threaded
            ? "Running in basic mode — apply the feed migration for topics, photos and polls."
            : "Replies are showing as separate posts until the feed migration is applied."
        );
      }

      const ids = rows.map((row) => row.id);
      const likes = await fetchLikes(ids);
      setLikeRows(likes);

      const counts: Record<string, number> = {};
      const mine: Record<string, boolean> = {};
      for (const like of likes) {
        counts[like.post_id] = (counts[like.post_id] ?? 0) + 1;
        if (like.user_id === myIdRef.current) mine[like.post_id] = true;
      }
      setLikeCount(counts);
      setLiked(mine);
    },
    [query, seedLikes, showToast]
  );

  // Session, profile, first page, notifications, realtime.
  useEffect(() => {
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    async function init() {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setLoading(false); return; }

      const uid = session.user.id;
      myIdRef.current = uid;
      setMyId(uid);

      const { data: profile } = await supabase
        .from("profiles")
        .select("username")
        .eq("id", uid)
        .single();

      if (cancelled) return;
      setUsername(profile?.username || "");
      setReady(true);

      await supabase
        .from("public_feed_notifications")
        .update({ is_read: true })
        .eq("user_id", uid)
        .eq("is_read", false);

      channel = supabase
        .channel(`public-feed-${uid}-${Date.now()}`)
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "public_feed_posts" },
          (payload) => {
            const row = sanitize(payload.new as FeedPost);
            if (new Date(row.expires_at).getTime() <= Date.now()) return;
            /* My own post is already in state from the POST response, which
               carries more of the row than this payload does. */
            if (row.author_id === myIdRef.current) return;

            if (row.parent_post_id) {
              const parentId = row.parent_post_id;
              /* A reply only belongs in the tree if its parent's thread is
                 loaded; otherwise the count is the honest thing to move, and
                 opening the thread will fetch it properly. */
              if (threadsLoaded.current.has(parentId) || modeRef.current === "fallback") {
                setPosts((current) => mergeRows(current, [row]));
              } else {
                setPosts((current) =>
                  current.map((post) =>
                    post.id === parentId
                      ? { ...post, reply_count: (post.reply_count ?? 0) + 1 }
                      : post
                  )
                );
              }
              return;
            }

            /* A new root only belongs at the top of a feed that is actually
               ordered newest-first and unfiltered. Anywhere else it would jump
               the ranking, so it is announced instead. */
            const canPrepend =
              modeRef.current === "rpc" && sortRef.current === "new" &&
              !topicRef.current && !searchRef.current.trim();

            if (canPrepend) {
              setPosts((current) => mergeRows(current, [row]));
              setRootOrder((current) =>
                current.includes(row.id) ? current : [row.id, ...current]
              );
              seedLikes([row]);
              return;
            }

            setPendingNew((current) =>
              current.includes(row.id) ? current : [...current, row.id]
            );
          }
        )
        .on(
          "postgres_changes",
          { event: "DELETE", schema: "public", table: "public_feed_posts" },
          (payload) => {
            const { id } = payload.old as { id: string };
            setPosts((current) => current.filter((post) => post.id !== id));
            setRootOrder((current) => current.filter((rootId) => rootId !== id));
            setPendingNew((current) => current.filter((pendingId) => pendingId !== id));
          }
        )
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "public_feed_likes" },
          (payload) => {
            const like = payload.new as FeedLike;
            // My own like is already counted locally; counting it twice is the bug.
            if (like.user_id === myIdRef.current) return;
            setLikeCount((current) => ({
              ...current,
              [like.post_id]: (current[like.post_id] ?? 0) + 1,
            }));
            setLikeRows((current) =>
              current.some((row) => row.post_id === like.post_id && row.user_id === like.user_id)
                ? current
                : [...current, like]
            );
          }
        )
        .on(
          "postgres_changes",
          { event: "DELETE", schema: "public", table: "public_feed_likes" },
          (payload) => {
            const like = payload.old as FeedLike;
            if (like.user_id === myIdRef.current) return;
            setLikeCount((current) => ({
              ...current,
              [like.post_id]: Math.max(0, (current[like.post_id] ?? 0) - 1),
            }));
            setLikeRows((current) =>
              current.filter(
                (row) => !(row.post_id === like.post_id && row.user_id === like.user_id)
              )
            );
          }
        )
        /* `public_feed_poll_votes` is in the realtime publication but is
           deliberately not subscribed to. A vote *change* arrives as an UPDATE
           whose `old` record carries only the primary key, so there is no way to
           know which option to decrement — and a tally that drifts is worse than
           one that refreshes when you vote. */
        .subscribe();
    }

    void init();
    return () => { cancelled = true; if (channel) supabase.removeChannel(channel); };
    // showToast is stable from the provider; init must run exactly once per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // First page, and again whenever the tab, topic or search term changes.
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;

    setLoading(true);
    (async () => {
      await loadPage(0, true);
      if (!cancelled) {
        setLoading(false);
        setPendingNew([]);
      }
    })();

    return () => { cancelled = true; };
  }, [ready, loadPage]);

  // Whisper of the Day, once per mount.
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    (async () => {
      const row = await fetchSpotlight();
      if (!cancelled && row) setSpotlight(sanitize(row));
    })();
    return () => { cancelled = true; };
  }, [ready]);

  /**
   * Posts expire 24 hours after they're written, and the row carrying that
   * deadline is only re-read on load. Without a sweep, a tab left open overnight
   * keeps rendering posts the server would already refuse to return.
   */
  useEffect(() => {
    const timer = setInterval(() => {
      const now = Date.now();
      setPosts((current) => {
        const live = current.filter((post) => new Date(post.expires_at).getTime() > now);
        return live.length === current.length ? current : live;
      });
    }, 60_000);

    return () => clearInterval(timer);
  }, []);

  // The highlight pulse is a one-shot, not a state a post stays in.
  useEffect(() => {
    if (!highlight) return;
    const timer = setTimeout(() => setHighlight(null), 2600);
    return () => clearTimeout(timer);
  }, [highlight]);

  /* ---------------------------------------------------------------------
     Deriving what renders
     --------------------------------------------------------------------- */

  const likesByPost = useMemo(
    () =>
      likeRows.reduce<Record<string, FeedLike[]>>((result, like) => {
        (result[like.post_id] ||= []).push(like);
        return result;
      }, {}),
    [likeRows]
  );

  const tree = useMemo(() => buildPostTree(posts), [posts]);

  const { roots, moreAvailable } = useMemo<{
    roots: FeedPostNode[];
    moreAvailable: boolean;
  }>(() => {
    if (mode === "rpc") {
      const byId = new Map(tree.map((node) => [node.id, node]));
      const ordered = rootOrder
        .map((id) => byId.get(id))
        .filter((node): node is FeedPostNode => Boolean(node));
      return { roots: ordered, moreAvailable: hasMore };
    }

    /* Fallback: everything the window holds, filtered and ranked here because
       there is no server-side reader to do it. */
    const term = search.trim().toLowerCase();
    let list = tree;
    if (topic) list = list.filter((node) => node.topic === topic);
    if (term) list = list.filter((node) => node.body.toLowerCase().includes(term));

    const ranked = rankFeedPosts(list, sort, { likesByPost, myId });
    return {
      roots: ranked.slice(0, visibleCount),
      moreAvailable: ranked.length > visibleCount,
    };
  }, [mode, tree, rootOrder, hasMore, search, topic, sort, likesByPost, myId, visibleCount]);

  const filtering = Boolean(topic) || Boolean(search.trim());

  /* ---------------------------------------------------------------------
     Infinite scroll
     --------------------------------------------------------------------- */

  const loadMore = useCallback(async () => {
    if (loadingMore || !moreAvailable) return;

    if (modeRef.current === "fallback") {
      setVisibleCount((current) => current + FEED_PAGE_SIZE);
      return;
    }

    setLoadingMore(true);
    try {
      await loadPage(rootOrder.length, false);
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, moreAvailable, loadPage, rootOrder.length]);

  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const loadMoreRef = useRef(loadMore);
  useEffect(() => { loadMoreRef.current = loadMore; }, [loadMore]);

  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || typeof IntersectionObserver === "undefined") return;

    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) void loadMoreRef.current();
      },
      /* Fires well before the sentinel is visible, so the next page is usually
         already in place by the time the reader reaches the bottom. */
      { rootMargin: "600px 0px" }
    );

    io.observe(node);
    return () => io.disconnect();
  }, [moreAvailable, loading]);

  /* ---------------------------------------------------------------------
     Writing
     --------------------------------------------------------------------- */

  const createPost = useCallback(
    async (draft: ComposerDraft): Promise<boolean> => {
      if (!myId || !ownLink) {
        showToast("Set a username before posting.");
        return false;
      }

      /* Checked before the upload rather than after: the API route refuses a
         photo with no preview, and finding that out afterwards would leave an
         orphan object in the bucket. */
      if (draft.image && !draft.image.preview) {
        showToast("Couldn't build a preview for that photo. Try a different one.");
        return false;
      }

      /* Refused rather than queued. Posting spends coins, so a write that lands
         later — against a balance that has since changed, into a feed window that
         has since rolled over — is worse than one that plainly didn't happen. */
      if (!requireOnline(showToast, "Posting")) return false;

      let imagePath: string | null = null;

      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) { showToast("Login required"); return false; }

        if (draft.image) {
          /* `<uid>/<uuid>.<ext>` — the bucket's insert policy checks the first
             segment against auth.uid(), so the folder is the authorization. */
          const key = `${myId}/${crypto.randomUUID()}.${draft.image.extension}`;
          const { error: uploadError } = await supabase.storage
            .from("feed-photos")
            .upload(key, draft.image.upload, {
              contentType: draft.image.contentType,
              upsert: false,
            });

          if (uploadError) {
            showToast(
              /^bucket not found$/i.test(uploadError.message)
                ? "Photo whispers aren't set up on this server yet."
                : uploadError.message
            );
            return false;
          }
          imagePath = key;
        }

        const res = await fetch("/api/coins/feed-post", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            message: draft.body,
            topic: draft.topic,
            imagePath,
            imagePreview: draft.image?.preview ?? null,
            pollOptions: draft.poll,
          }),
        });
        const json = await res.json();

        if (!res.ok) {
          showToast(json.error || "Couldn't post that.");
          /* The route unwinds its own failures, but a rejection that never got
             as far as charging leaves the object behind. Removing it here costs
             one request and keeps the bucket clean. */
          if (imagePath) {
            await supabase.storage.from("feed-photos").remove([imagePath]);
          }
          return false;
        }

        if (json.post) {
          const row = sanitize(json.post as FeedPost);
          setPosts((current) => mergeRows(current, [row]));
          setRootOrder((current) =>
            current.includes(row.id) ? current : [row.id, ...current]
          );
          setLikeCount((current) => ({ ...current, [row.id]: 0 }));
        }

        vibrate(HAPTIC.success);
        showToast(`Posted — live for 24 hours. ${FEED_POST_COST} coins charged.`);
        return true;
      } catch (error) {
        console.error(error);
        showToast("Network error");
        if (imagePath) {
          await supabase.storage.from("feed-photos").remove([imagePath]);
        }
        return false;
      }
    },
    [myId, ownLink, showToast]
  );

  const sendReply = useCallback(
    async (postId: string) => {
      const text = (replyTextMap[postId] || "").trim();
      if (!text) { showToast("Write a reply first"); return; }
      if (!requireOnline(showToast, "Replying")) return;

      setReplySendingMap((map) => ({ ...map, [postId]: true }));
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) { showToast("Login required"); return; }

        const res = await fetch("/api/coins/feed-post", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ message: text, parentPostId: postId }),
        });
        const json = await res.json();

        if (!res.ok) {
          showToast(json.error || "Failed to send reply");
          return;
        }

        showToast("Reply posted.");
        if (json.post) {
          const row = sanitize(json.post as FeedPost);
          setPosts((current) => mergeRows(current, [row]));
          /* Nothing else on screen knows this reply exists yet, so the parent's
             own count moves with it — the tree is the source once open. */
          threadsLoaded.current.add(postId);
        }
        setReplyTextMap((map) => ({ ...map, [postId]: "" }));
        setReplyOpen((map) => ({ ...map, [postId]: false }));
        setExpandedThreads((map) => ({ ...map, [postId]: true }));
      } catch (error) {
        console.error(error);
        showToast("Network error");
      } finally {
        setReplySendingMap((map) => ({ ...map, [postId]: false }));
      }
    },
    [replyTextMap, showToast]
  );

  /* Held in a ref so `requestSend` keeps a stable identity: `sendReply` is a
     fresh closure whenever the draft changes, and putting it in the controller's
     dependency list would re-render every post in the feed on every keystroke. */
  const sendReplyRef = useRef(sendReply);
  useEffect(() => { sendReplyRef.current = sendReply; }, [sendReply]);

  const requestSend = useCallback((postId: string) => {
    void sendReplyRef.current(postId);
  }, []);

  async function deletePost(postId: string) {
    const { error } = await supabase
      .from("public_feed_posts")
      .delete()
      .eq("id", postId)
      .eq("author_id", myId);

    if (error) {
      showToast(error.message);
    } else {
      const removed = postsRef.current.find((post) => post.id === postId);
      setPosts((current) => current.filter((post) => post.id !== postId));
      setRootOrder((current) => current.filter((id) => id !== postId));
      /* A deleted reply has to come off its parent's count, or the tab keeps
         advertising a reply that isn't there. */
      if (removed?.parent_post_id) {
        const parentId = removed.parent_post_id;
        setPosts((current) =>
          current.map((post) =>
            post.id === parentId
              ? { ...post, reply_count: Math.max(0, (post.reply_count ?? 1) - 1) }
              : post
          )
        );
      }
    }
    setDeleteTarget(null);
  }

  /* ---------------------------------------------------------------------
     Engagement
     --------------------------------------------------------------------- */

  const toggleLike = useCallback(
    async (postId: string) => {
      if (!myId) return;

      const wasLiked = Boolean(likedRef.current[postId]);
      likedRef.current = { ...likedRef.current, [postId]: !wasLiked };
      setLiked(likedRef.current);
      setLikeCount((current) => ({
        ...current,
        [postId]: Math.max(0, (current[postId] ?? 0) + (wasLiked ? -1 : 1)),
      }));
      setLikeRows((current) =>
        wasLiked
          ? current.filter((row) => !(row.post_id === postId && row.user_id === myId))
          : [...current, { post_id: postId, user_id: myId }]
      );
      vibrate(HAPTIC.tap);

      const result = wasLiked
        ? await supabase.from("public_feed_likes").delete().eq("post_id", postId).eq("user_id", myId)
        : await supabase.from("public_feed_likes").insert({ post_id: postId, user_id: myId });

      if (result.error) {
        showToast(result.error.message);
        // Undo in both places, or the button disagrees with the server until reload.
        likedRef.current = { ...likedRef.current, [postId]: wasLiked };
        setLiked(likedRef.current);
        setLikeCount((current) => ({
          ...current,
          [postId]: Math.max(0, (current[postId] ?? 0) + (wasLiked ? 1 : -1)),
        }));
        setLikeRows((current) =>
          wasLiked
            ? [...current, { post_id: postId, user_id: myId }]
            : current.filter((row) => !(row.post_id === postId && row.user_id === myId))
        );
      }
    },
    [myId, showToast]
  );

  const toggleReplyBox = useCallback((postId: string) => {
    setReplyOpen((map) => ({ ...map, [postId]: !map[postId] }));
  }, []);

  const setReplyText = useCallback((postId: string, value: string) => {
    setReplyTextMap((map) => ({ ...map, [postId]: value }));
  }, []);

  const toggleThread = useCallback(async (postId: string) => {
    const willOpen = !expandedRef.current[postId];
    expandedRef.current = { ...expandedRef.current, [postId]: willOpen };
    setExpandedThreads(expandedRef.current);

    if (!willOpen) return;
    // The fallback path already holds the whole window, replies included.
    if (modeRef.current === "fallback") return;
    if (threadsLoaded.current.has(postId)) return;

    setThreadLoading((map) => ({ ...map, [postId]: true }));
    const rows = await fetchThread(postId);
    if (rows) {
      threadsLoaded.current.add(postId);
      const clean = rows.map(sanitize);
      setPosts((current) => mergeRows(current, clean));
      seedLikes(clean);
    }
    setThreadLoading((map) => ({ ...map, [postId]: false }));
  }, [seedLikes]);

  /**
   * Casts or changes a poll vote.
   *
   * Not optimistic, on purpose. The choice is knowable locally but the tallies
   * are not, and rendering a bar chart from a guessed total would put a number on
   * screen that nobody wrote. The pending state is the instant feedback; the real
   * counts arrive with the response.
   */
  const vote = useCallback(
    async (postId: string, optionIndex: number) => {
      if (pollPendingRef.current[postId]) return;

      pollPendingRef.current = { ...pollPendingRef.current, [postId]: true };
      setPollPending(pollPendingRef.current);
      vibrate(HAPTIC.tap);

      const result = await votePoll(postId, optionIndex);

      if ("error" in result) {
        showToast(result.error);
      } else {
        setPollCounts((current) => ({ ...current, [postId]: result.counts }));
        setPollChoice((current) => ({ ...current, [postId]: optionIndex }));
      }

      pollPendingRef.current = { ...pollPendingRef.current, [postId]: false };
      setPollPending(pollPendingRef.current);
    },
    [showToast]
  );

  /**
   * Spends this viewer's one look at a photo whisper.
   *
   * The state only ever moves forward — a failed request drops back to locked so
   * the tap can be retried, but a served photo is marked spent immediately,
   * because the receipt on the server has already been written by then.
   */
  const openImage = useCallback(
    async (postId: string) => {
      if (imageStateRef.current[postId] === "loading") return;

      const post = postsRef.current.find((item) => item.id === postId);
      const isAuthor = Boolean(post && post.author_id === myIdRef.current);
      const current = imageStateRef.current[postId] ?? (post?.viewer_image_viewed ? "spent" : "locked");
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
        /* Authors are exempt from the receipt server-side, so their plate goes
           back to openable rather than spent. */
        set(isAuthor ? "locked" : "spent");
        vibrate(HAPTIC.tap);
      } catch (error) {
        console.error(error);
        showToast("Network error");
        set("locked");
      }
    },
    [showToast]
  );

  const closePhoto = useCallback(() => {
    setPhotoUrl((current) => {
      if (current) URL.revokeObjectURL(current);
      return null;
    });
  }, []);

  // A blob URL held across a navigation is a leaked decoded bitmap.
  useEffect(() => {
    return () => { if (photoUrl) URL.revokeObjectURL(photoUrl); };
  }, [photoUrl]);

  /* ---------------------------------------------------------------------
     Discovery
     --------------------------------------------------------------------- */

  const scrollToPost = useCallback((postId: string) => {
    window.requestAnimationFrame(() => {
      document
        .querySelector(`[data-post-id="${postId}"]`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }, []);

  /**
   * Brings one post into the timeline and puts the reader on it.
   *
   * Shared by the `?post=` deep link, Whisper of the Day and Surprise Me. A
   * shared link can point at a reply, so this walks up to the root — a reply
   * rendered as a root is exactly the orphaned, contextless card `buildPostTree`
   * exists to prevent — then loads that root's thread so the target has its
   * siblings around it.
   */
  const focusPost = useCallback(
    async (postId: string, preloaded?: FeedPost) => {
      const first = preloaded ? sanitize(preloaded) : await fetchPostById(postId);
      if (!first) {
        showToast("That whisper is no longer available.");
        return;
      }

      const chain: FeedPost[] = [sanitize(first)];
      let hops = 0;
      while (chain[0].parent_post_id && hops < 6) {
        const parent = await fetchPostById(chain[0].parent_post_id);
        if (!parent) break;
        chain.unshift(sanitize(parent));
        hops += 1;
      }

      const root = chain[0];
      setPosts((current) => mergeRows(current, chain));
      setRootOrder((current) => (current.includes(root.id) ? current : [root.id, ...current]));
      seedLikes(chain);

      if (root.id !== postId) {
        const thread = await fetchThread(root.id);
        if (thread) {
          const clean = thread.map(sanitize);
          threadsLoaded.current.add(root.id);
          setPosts((current) => mergeRows(current, clean));
          seedLikes(clean);
        }
        expandedRef.current = { ...expandedRef.current, [root.id]: true };
        setExpandedThreads(expandedRef.current);
      }

      setHighlight(postId);
      scrollToPost(postId);
    },
    [scrollToPost, seedLikes, showToast]
  );

  // A shared link. Read from `location` rather than `useSearchParams` so this
  // page needs no Suspense boundary to prerender.
  const deepLinkHandled = useRef(false);
  useEffect(() => {
    if (!ready || deepLinkHandled.current) return;
    deepLinkHandled.current = true;

    const target = new URLSearchParams(window.location.search).get("post");
    if (target) void focusPost(target);
  }, [ready, focusPost]);

  const surprise = useCallback(async () => {
    setSurprising(true);
    try {
      let row = await fetchRandomPost(seenRandom.current);
      /* Seen everything. Clearing the exclusion list is the difference between
         "Surprise Me" going dead and it starting a second lap. */
      if (!row && seenRandom.current.length) {
        seenRandom.current = [];
        row = await fetchRandomPost([]);
      }

      if (!row) {
        showToast("Nothing new to surprise you with yet.");
        return;
      }

      seenRandom.current = [...seenRandom.current, row.id];
      await focusPost(row.id, row);
    } finally {
      setSurprising(false);
    }
  }, [focusPost, showToast]);

  /*
   * The three ways into the composer.
   *
   * All of them open the same sheet and differ only in what it opens *with*, which
   * is why they all bump one nonce rather than each owning a flag: the composer
   * reads the prefill triplet at the moment the nonce changes, so setting the three
   * values and then bumping is the whole protocol.
   */
  const answerDailyQuestion = useCallback(() => {
    setPrefillBody(`${dailyQuestion}\n\n`);
    setPrefillTopic("question");
    setPrefillPoll(false);
    setPrefillNonce((nonce) => nonce + 1);
    setComposerOpen(true);
  }, [dailyQuestion]);

  const focusComposer = useCallback(() => {
    setPrefillBody("");
    setPrefillTopic(null);
    setPrefillPoll(false);
    setPrefillNonce((nonce) => nonce + 1);
    setComposerOpen(true);
  }, []);

  const startPoll = useCallback(() => {
    setPrefillBody("");
    setPrefillTopic(null);
    setPrefillPoll(true);
    setPrefillNonce((nonce) => nonce + 1);
    setComposerOpen(true);
  }, []);

  /* ---------------------------------------------------------------------
     Sheets
     --------------------------------------------------------------------- */

  const copyLink = useCallback(
    async (post: FeedPost) => {
      try {
        await navigator.clipboard.writeText(feedPostUrl(post.id));
        showToast("Link copied to your clipboard.");
      } catch {
        showToast("Couldn't copy that link.");
      }
    },
    [showToast]
  );

  const submitReport = useCallback(
    async (post: FeedPost, reason: ReportReason, details: string) => {
      setReporting(true);
      const result = await reportPost(post.id, myId, reason, details);
      setReporting(false);

      if (!result.ok) {
        showToast(result.error);
        return;
      }
      setReportTarget(null);
      showToast("Thanks — a moderator will look at this.");
    },
    [myId, showToast]
  );

  const block = useCallback(
    async (post: FeedPost) => {
      const result = await blockAuthor(post.author_id, myId);
      if (!result.ok) {
        showToast(result.error);
        return;
      }
      /* Their posts come out of the timeline immediately. The server filter will
         agree on the next load; waiting for it would leave the person you just
         blocked on screen. */
      const authorId = post.author_id;
      setPosts((current) => current.filter((item) => item.author_id !== authorId));
      setRootOrder((current) => {
        const gone = new Set(
          postsRef.current.filter((item) => item.author_id === authorId).map((item) => item.id)
        );
        return current.filter((id) => !gone.has(id));
      });
      showToast("Blocked. You won't see their whispers again.");
    },
    [myId, showToast]
  );

  const requestDelete = useCallback((postId: string) => setDeleteTarget(postId), []);
  const openMenu = useCallback((post: FeedPost) => setMenuPost(post), []);
  const openShare = useCallback((post: FeedPost) => setSharePost(post), []);

  const refreshFeed = useCallback(async () => {
    vibrate(HAPTIC.tap);
    setPendingNew([]);
    setLoading(true);
    await loadPage(0, true);
    setLoading(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [loadPage]);

  /* ---------------------------------------------------------------------
     The controller
     --------------------------------------------------------------------- */

  const controller: FeedController = useMemo(
    () => ({
      myId,
      replyCost: FEED_REPLY_COST,
      reducedMotion,
      likeCount,
      liked,
      replyOpen,
      replyText: replyTextMap,
      replySending: replySendingMap,
      expanded: expandedThreads,
      threadLoading,
      pollCounts,
      pollChoice,
      pollPending,
      imageState,
      onToggleLike: toggleLike,
      onToggleReplyBox: toggleReplyBox,
      onReplyTextChange: setReplyText,
      onRequestSend: requestSend,
      onToggleThread: toggleThread,
      onRequestDelete: requestDelete,
      onShare: openShare,
      onVote: vote,
      onOpenImage: openImage,
      onOpenMenu: openMenu,
    }),
    [
      myId, reducedMotion, likeCount, liked, replyOpen, replyTextMap, replySendingMap,
      expandedThreads, threadLoading, pollCounts, pollChoice, pollPending, imageState,
      toggleLike, toggleReplyBox, setReplyText, requestSend, toggleThread, requestDelete,
      openShare, vote, openImage, openMenu,
    ]
  );

  return (
    <main
      className={`feed-page min-h-screen theme-bg-gradient pb-28 ${
        chromeHidden ? "is-chrome-hidden" : ""
      }`}
    >
      {/* `body` pads by the safe-area inset, so the timeline scrolls up into the
          strip under the notch with nothing behind it. Every other screen is
          inset and never reaches that strip; this is the one whose column runs to
          the edge. Zero height, and therefore free, without an inset. */}
      <div className="feed-statusbar" aria-hidden />

      <div className="feed-shell">
        {/* The bar and the tabs pin as one object and retract as one object —
            two separately sticky elements meant two stacked blurs and a tab row
            whose sticky `top` had to be animated to keep up. */}
        <div className="feed-chrome">
          <FeedTopBar
            authorId={myId}
            onOpenDrawer={() => setDrawerOpen(true)}
            onOpenSearch={() => {
              /* Closing clears the term for the same reason the topic filter does —
                 a filter nobody can see reads as an empty feed. */
              if (searchOpen && search) setSearch("");
              setSearchOpen((open) => !open);
            }}
            searchOpen={searchOpen}
            hasDiscovery={Boolean(spotlight) || !answeredToday}
          />

          <FeedTabs
            sort={sort}
            topic={topic}
            onSortChange={setSort}
            onTopicChange={setTopic}
            reducedMotion={reducedMotion}
            showTopics={mode !== "fallback"}
          />
        </div>

        <AnimatePresence initial={false}>
          {(searchOpen || Boolean(search)) && (
            <motion.div
              key="feed-search"
              className="feed-search-collapse"
              initial={reducedMotion ? { opacity: 0 } : { height: 0, opacity: 0 }}
              animate={reducedMotion ? { opacity: 1 } : { height: "auto", opacity: 1 }}
              exit={reducedMotion ? { opacity: 0 } : { height: 0, opacity: 0 }}
              transition={reducedMotion ? { duration: 0 } : tween.base}
            >
              <FeedSearchBar value={search} onSearch={setSearch} />
            </motion.div>
          )}
        </AnimatePresence>

        {/* No panel around this. The timeline is one column of hairline-separated
            rows running edge to edge — a post inside its own rounded rectangle,
            inside another rounded rectangle, on a gradient, is three frames around
            one paragraph, and it is what made the page read as boxes rather than
            as a feed. */}
        <section
          className="feed-timeline"
          aria-label="Public feed timeline"
          aria-busy={loading}
        >
          {loading ? (
            <FeedSkeleton />
          ) : roots.length === 0 ? (
            filtering ? (
              <EmptyState
                icon={<SearchX size={26} />}
                title="Nothing matches"
                description="No live whisper fits that filter. The feed only holds the last 24 hours, so there is less here than you might expect."
                action={{
                  label: "Clear filters",
                  onClick: () => {
                    setTopic(null);
                    setSearch("");
                  },
                }}
              />
            ) : (
              <EmptyState
                icon={<MessageSquareDashed size={26} />}
                title="The feed is quiet"
                description="Posts here disappear after 24 hours, so there is nothing to catch up on yet. Say the first thing."
                action={{ label: "Write a post", onClick: focusComposer }}
              />
            )
          ) : (
            <>
              {roots.map((post) => (
                <FeedPostCard
                  key={post.id}
                  node={post}
                  controller={controller}
                  depth={0}
                  impressionRef={impressionRef}
                  highlightId={highlight}
                />
              ))}

              {moreAvailable ? (
                <div ref={sentinelRef} className="feed-sentinel">
                  {/* Shimmer only while a page is actually in flight. A
                      permanent skeleton at the foot of the list claims a
                      request that isn't running. */}
                  {loadingMore && <FeedSkeleton rows={1} />}
                </div>
              ) : (
                <p className="feed-end">You&apos;re all caught up.</p>
              )}
            </>
          )}
        </section>
      </div>

      <FeedDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        authorId={myId}
        displayName={anonName(myId)}
        handle={username || null}
        question={dailyQuestion}
        spotlight={spotlight}
        surprising={surprising}
        onAnswerQuestion={answerDailyQuestion}
        onOpenSpotlight={(post) => void focusPost(post.id, post)}
        onSurprise={() => void surprise()}
        onStartPoll={startPoll}
        reducedMotion={reducedMotion}
      />

      <FeedComposerSheet
        open={composerOpen}
        onClose={() => setComposerOpen(false)}
        authorId={myId}
        ownLink={ownLink}
        postCost={FEED_POST_COST}
        prefillNonce={prefillNonce}
        prefillBody={prefillBody}
        prefillTopic={prefillTopic}
        prefillPoll={prefillPoll}
        onSubmit={createPost}
      />

      {/* Hidden while a full-screen surface is up, so it cannot float over a
          sheet it has no relationship with. */}
      <FeedFab
        onClick={focusComposer}
        hidden={drawerOpen || composerOpen || Boolean(photoUrl)}
        reducedMotion={reducedMotion}
      />

      {/* Announced rather than injected: a post that jumped into a ranked feed
          would reorder the list under the reader's thumb. */}
      <AnimatePresence>
        {pendingNew.length > 0 && !loading && (
          <motion.button
            type="button"
            onClick={() => void refreshFeed()}
            initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: -12 }}
            animate={reducedMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
            exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: -12 }}
            transition={{ type: "spring", stiffness: 420, damping: 34 }}
            className="feed-new-pill"
          >
            <ArrowUp size={14} aria-hidden />
            {pendingNew.length === 1 ? "1 new whisper" : `${pendingNew.length} new whispers`}
          </motion.button>
        )}
      </AnimatePresence>

      <FeedPostMenu
        post={menuPost}
        isMine={Boolean(menuPost && menuPost.author_id === myId)}
        onClose={() => setMenuPost(null)}
        onCopyLink={(post) => void copyLink(post)}
        onShare={openShare}
        onReport={setReportTarget}
        onBlock={(post) => void block(post)}
        onDelete={(post) => requestDelete(post.id)}
      />

      <FeedShareSheet
        post={sharePost}
        onClose={() => setSharePost(null)}
        onCopy={(post) => void copyLink(post)}
      />

      <FeedReportSheet
        post={reportTarget}
        submitting={reporting}
        onClose={() => setReportTarget(null)}
        onSubmit={(post, reason, details) => void submitReport(post, reason, details)}
      />

      {/* Rendered unconditionally: the viewer owns its own `AnimatePresence` and
          reads `src === null` as closed. Unmounting it here instead would delete
          the exiting element before its exit could play. */}
      <FeedPhotoViewer src={photoUrl} onClose={closePhoto} />

      {/* No reply confirmation: a dialog earns its place when an action spends
          money or destroys something, and a free reply does neither. Delete keeps
          one, because that is irreversible. */}
      {deleteTarget && (
        <ConfirmDialog
          title="Delete this post?"
          description="It will disappear from the public feed along with every reply under it."
          onCancel={() => setDeleteTarget(null)}
          onConfirm={() => { void deletePost(deleteTarget); }}
        />
      )}

      <BottomNavigation />
    </main>
  );
}
