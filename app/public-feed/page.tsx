"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Send, Sparkles } from "lucide-react";
import BackButton from "@/components/BackButton";
import BottomNavigation from "@/components/BottomNavigation";
import GlassPanel from "@/components/GlassPanel";
import WhisperCoinIcon from "@/components/WhisperCoinIcon";
import ConfirmDialog from "@/components/ConfirmDialog";
import FeedPostCard from "@/components/feed/FeedPostCard";
import type { FeedController } from "@/components/feed/types";
import { supabase } from "@/lib/supabase/client";
import { useToast } from "@/components/ToastProvider";
import {
  buildPostTree,
  stripLinks,
  upsertPost,
  type FeedLike,
  type FeedPost,
} from "@/lib/feed";

import { FEED_POST_COST, FEED_REPLY_COST } from "@/lib/coins";

/* Replies are free now and posting is what costs — see lib/coins.ts for why. The
   old `REPLY_COST` constant is gone rather than set to 0, so nothing can still be
   rendering "2 coins" next to a reply button. */

/**
 * Columns beyond the original feed schema.
 *
 * Support is probed per column, not as a prefix cascade. These ship in
 * independent migrations, so any combination of them can be missing — and the
 * previous version dropped them from the end of this list one at a time, which
 * coupled them together. On a database missing only `view_count`, the first
 * retry discarded `parent_post_id` — the column that tells a reply from a post
 * — while keeping the column that actually didn't exist. The query failed
 * again and the feed fell all the way back to the bare table, so threading
 * died because of an unrelated missing column.
 */
const BASE_COLUMNS = "id,author_id,body,whisper_link,created_at,expires_at";
const OPTIONAL_COLUMNS = ["parent_post_id", "view_count"] as const;

const SUGGESTED_POST = "Hi everyone! I have a little time to talk. Send me an anonymous Whisper and let’s see where the conversation goes.";
const AI_SUGGESTIONS = [
  SUGGESTED_POST,
  "I am in the mood for an honest conversation. Leave me a Whisper and tell me what is on your mind.",
  "Quick question for the community: what is one small thing that made you smile today? Send your answer anonymously.",
  "I am taking anonymous questions today. Ask me anything and I will answer as honestly as I can.",
  "Sometimes a stranger has the best advice. Leave me a Whisper and share something you have learned recently.",
  "Drop a kind message for someone who needs it today. My Whisper link is open for anonymous notes.",
  "I want to hear a story I have never heard before. Send me an anonymous Whisper and surprise me.",
  "No pressure, no names, just a real conversation. Say hello through my Whisper link.",
  "What would you tell your future self today? Leave your answer anonymously on my Whisper.",
  "I am collecting honest opinions. Tell me one thing you think more people should talk about.",
];

/**
 * Fetches the live feed, keeping every optional column the server accepts.
 *
 * The happy path is one request. Only when that fails does this bisect: each
 * optional column is probed on its own, and the real query is re-run with the
 * survivors. So a database missing `view_count` still gets threading, which is
 * the case the old prefix-shedding version got wrong.
 *
 * Returns the rows plus whether threading survived, so the caller can say so
 * rather than silently rendering a flat feed that looks like a bug.
 */
async function fetchFeedPosts(): Promise<{ rows: FeedPost[]; threaded: boolean }> {
  const select = (columns: string) =>
    supabase
      .from("public_feed_posts")
      .select(columns)
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false });

  const all = [BASE_COLUMNS, ...OPTIONAL_COLUMNS].join(",");
  const first = await select(all);

  if (!first.error) {
    return { rows: (first.data || []) as unknown as FeedPost[], threaded: true };
  }

  console.warn(`Public feed select failed with [${all}]:`, first.error.message);

  /* Probe each optional column alone. `head: true` asks for no rows, so this
     costs a schema check rather than a second copy of the feed. */
  const supported: string[] = [];
  for (const column of OPTIONAL_COLUMNS) {
    const { error } = await supabase
      .from("public_feed_posts")
      .select(`id,${column}`)
      .limit(1);

    if (!error) supported.push(column);
    else console.warn(`Public feed column [${column}] unavailable:`, error.message);
  }

  const columns = [BASE_COLUMNS, ...supported].join(",");
  const { data, error } = await select(columns);

  if (error) {
    console.error(`Public feed select failed with [${columns}]:`, error.message);
    return { rows: [], threaded: false };
  }

  return {
    rows: (data || []) as unknown as FeedPost[],
    threaded: supported.includes("parent_post_id"),
  };
}

export default function PublicFeedPage() {
  const { showToast } = useToast();
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [likes, setLikes] = useState<FeedLike[]>([]);
  const [body, setBody] = useState("");
  const [myId, setMyId] = useState("");
  const [username, setUsername] = useState("");
  const [loading, setLoading] = useState(true);
  const [posting, setPosting] = useState(false);
  const [showAiSuggestions, setShowAiSuggestions] = useState(false);
  const [replyOpen, setReplyOpen] = useState<Record<string, boolean>>({});
  const [replyTextMap, setReplyTextMap] = useState<Record<string, string>>({});
  const [replySendingMap, setReplySendingMap] = useState<Record<string, boolean>>({});
  const [expandedThreads, setExpandedThreads] = useState<Record<string, boolean>>({});
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const cleanBody = stripLinks(body);
  const ownLink = username ? `/u/${username}` : "";

  /* A synchronous mirror of `likes`, so a tap can read the current like state
     without waiting for a render. Realtime updates and the initial load land in
     state first and are copied across by the effect below. */
  const likesRef = useRef<FeedLike[]>([]);
  useEffect(() => { likesRef.current = likes; }, [likes]);

  // Impressions are batched: seen ids collect here and flush on a timer so a fast
  // scroll doesn't fire one request per card.
  const pendingImpressions = useRef<Set<string>>(new Set());
  const recordedImpressions = useRef<Set<string>>(new Set());
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flushImpressions = useCallback(async () => {
    const batch = Array.from(pendingImpressions.current);
    pendingImpressions.current.clear();
    if (!batch.length) return;

    const { error } = await supabase.rpc("record_public_feed_impressions", { post_ids: batch });
    if (error) {
      // Migration may not be applied yet — degrade silently, the counter just stays put.
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
    if (!myId || authorId === myId) return;
    if (recordedImpressions.current.has(postId)) return;

    recordedImpressions.current.add(postId);
    pendingImpressions.current.add(postId);

    if (flushTimer.current) clearTimeout(flushTimer.current);
    flushTimer.current = setTimeout(() => { void flushImpressions(); }, 900);
  }, [myId, flushImpressions]);

  useEffect(() => {
    return () => { if (flushTimer.current) clearTimeout(flushTimer.current); };
  }, []);

  // A single observer for every root card. Cards register through the ref callback
  // below; once a card has been counted it is unobserved so it can't fire twice.
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
    // Cards mounted before this effect ran still need picking up.
    observedNodes.current.forEach((node) => instance.observe(node));

    return () => { instance.disconnect(); observer.current = null; };
  }, []);

  const impressionRef = useCallback((node: HTMLElement | null) => {
    if (!node) return;
    observedNodes.current.add(node);
    observer.current?.observe(node);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    async function init() {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setLoading(false); return; }

      const uid = session.user.id;
      setMyId(uid);

      const { data: profile } = await supabase.from("profiles").select("username").eq("id", uid).single();
      const { rows, threaded } = await fetchFeedPosts();

      if (cancelled) return;

      setUsername(profile?.username || "");
      setPosts(rows);
      if (!threaded) {
        showToast("Replies are showing as separate posts until the feed migration is applied.");
      }

      const ids = rows.map((post) => post.id);
      if (ids.length) {
        const { data: likeRows } = await supabase.from("public_feed_likes").select("post_id,user_id").in("post_id", ids);
        if (!cancelled) setLikes((likeRows || []) as FeedLike[]);
      }

      await supabase.from("public_feed_notifications").update({ is_read: true }).eq("user_id", uid).eq("is_read", false);
      setLoading(false);

      channel = supabase
        .channel(`public-feed-${uid}-${Date.now()}`)
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "public_feed_posts" }, (payload) => {
          const post = payload.new as FeedPost;
          if (new Date(post.expires_at) > new Date()) setPosts((current) => upsertPost(current, post));
        })
        .on("postgres_changes", { event: "DELETE", schema: "public", table: "public_feed_posts" }, (payload) =>
          setPosts((current) => current.filter((post) => post.id !== (payload.old as { id: string }).id))
        )
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "public_feed_likes" }, (payload) => {
          const like = payload.new as FeedLike;
          setLikes((current) =>
            current.some((item) => item.post_id === like.post_id && item.user_id === like.user_id) ? current : [...current, like]
          );
        })
        .on("postgres_changes", { event: "DELETE", schema: "public", table: "public_feed_likes" }, (payload) => {
          const like = payload.old as FeedLike;
          setLikes((current) => current.filter((item) => !(item.post_id === like.post_id && item.user_id === like.user_id)));
        })
        .subscribe();
    }

    init();
    return () => { cancelled = true; if (channel) supabase.removeChannel(channel); };
    // showToast is stable from the provider; init must run exactly once per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Posts expire 24 hours after they're written, and the row that carries that
   * deadline is only re-read on mount. Without a sweep, a tab left open
   * overnight keeps rendering posts the server would already refuse to return.
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

  const likesByPost = useMemo(
    () => likes.reduce<Record<string, FeedLike[]>>((result, like) => { (result[like.post_id] ||= []).push(like); return result; }, {}),
    [likes]
  );
  const postTree = useMemo(() => buildPostTree(posts), [posts]);

  async function createPost(event: React.FormEvent) {
    event.preventDefault();
    if (!myId || !ownLink || !cleanBody || posting) return;

    setPosting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { showToast("Login required"); return; }

      /* Posted through the server rather than inserted straight from here,
         because a root post now costs coins and a browser cannot be trusted to
         debit its own wallet. The route reads the price, charges it, inserts the
         post, and refunds if the insert fails — so there is no window where the
         coins are gone and the post isn't there. */
      const res = await fetch("/api/coins/feed-post", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ message: cleanBody }),
      });
      const json = await res.json();

      if (!res.ok) {
        showToast(json.error || "Couldn't post that.");
        return;
      }

      if (json.post) setPosts((current) => upsertPost(current, json.post as FeedPost));
      setBody("");
      showToast(`Posted — live for 24 hours. ${FEED_POST_COST} coins charged.`);
    } catch (error) {
      console.error(error);
      showToast("Network error");
    } finally {
      setPosting(false);
    }
  }

  /**
   * Toggles a like.
   *
   * The liked/unliked decision is read from a ref rather than from inside the
   * state updater. React doesn't promise to run an updater synchronously, so a
   * flag assigned in there can still be false on the next line — which would
   * send an insert for a like that already exists on every second tap. The ref
   * is also advanced here, so a double tap resolves in the right direction
   * instead of both taps reading the same pre-tap value.
   */
  const toggleLike = useCallback(async (postId: string) => {
    if (!myId) return;

    const mine = (like: FeedLike) => like.post_id === postId && like.user_id === myId;
    const wasLiked = likesRef.current.some(mine);

    likesRef.current = wasLiked
      ? likesRef.current.filter((like) => !mine(like))
      : [...likesRef.current, { post_id: postId, user_id: myId }];

    setLikes((current) => {
      if (wasLiked) return current.filter((like) => !mine(like));
      return current.some(mine) ? current : [...current, { post_id: postId, user_id: myId }];
    });

    const result = wasLiked
      ? await supabase.from("public_feed_likes").delete().eq("post_id", postId).eq("user_id", myId)
      : await supabase.from("public_feed_likes").insert({ post_id: postId, user_id: myId });

    if (result.error) {
      showToast(result.error.message);
      /* The optimistic flip has to be undone in both places or the button
         disagrees with the server until the next mount. */
      likesRef.current = wasLiked
        ? [...likesRef.current, { post_id: postId, user_id: myId }]
        : likesRef.current.filter((like) => !mine(like));
      setLikes(likesRef.current);
    }
  }, [myId, showToast]);

  async function deletePost(postId: string) {
    const { error } = await supabase.from("public_feed_posts").delete().eq("id", postId).eq("author_id", myId);
    if (error) showToast(error.message);
    else setPosts((current) => current.filter((post) => post.id !== postId));
    setDeleteTarget(null);
  }

  async function sendReply(postId: string) {
    const text = (replyTextMap[postId] || "").trim();
    if (!text) { showToast("Write a reply first"); return; }

    setReplySendingMap((map) => ({ ...map, [postId]: true }));
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { showToast("Login required"); return; }

      const res = await fetch("/api/coins/feed-post", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ message: text, parentPostId: postId }),
      });
      const json = await res.json();

      if (!res.ok) {
        showToast(json.error || "Failed to send reply");
      } else {
        showToast("Reply posted.");
        if (json.post) setPosts((current) => upsertPost(current, json.post as FeedPost));
        setReplyTextMap((map) => ({ ...map, [postId]: "" }));
        setReplyOpen((map) => ({ ...map, [postId]: false }));
        // Make sure the new reply is visible even on a long thread.
        setExpandedThreads((map) => ({ ...map, [postId]: true }));
      }
    } catch (error) {
      console.error(error);
      showToast("Network error");
    } finally {
      setReplySendingMap((map) => ({ ...map, [postId]: false }));
    }
  }

  /**
   * Shares a post outward. The author's Whisper link is what makes the share
   * actionable — a quote with no way to answer it is just a screenshot.
   */
  const sharePost = useCallback(async (postId: string, postBody: string, whisperLink: string) => {
    const url = whisperLink ? `${window.location.origin}${whisperLink}` : window.location.href;
    const text = `"${postBody}" — on Whisper 👻`;

    if (navigator.share) {
      try {
        await navigator.share({ title: "Whisper", text, url });
        return;
      } catch {
        // Cancelled by the user, or unsupported for this payload — fall through.
      }
    }

    try {
      await navigator.clipboard.writeText(`${text}\n${url}`);
      showToast("Copied to your clipboard.");
    } catch {
      showToast("Couldn't share this post.");
    }
  }, [showToast]);

  const toggleReplyBox = useCallback((postId: string) => {
    setReplyOpen((map) => ({ ...map, [postId]: !map[postId] }));
  }, []);

  const setReplyText = useCallback((postId: string, value: string) => {
    setReplyTextMap((map) => ({ ...map, [postId]: value }));
  }, []);

  const toggleThread = useCallback((postId: string) => {
    setExpandedThreads((map) => ({ ...map, [postId]: !map[postId] }));
  }, []);

  /* Held in a ref so `requestSend` can keep a stable identity. `sendReply` is a
     fresh closure every render, and putting it in the dependency list would
     rebuild `controller` below on every render — which re-renders every post in
     the feed. The ref always points at the current closure, so nothing goes
     stale. */
  const sendReplyRef = useRef(sendReply);
  sendReplyRef.current = sendReply;

  /* Straight to send: replies are free, so there is no cost to confirm. */
  const requestSend = useCallback((postId: string) => {
    void sendReplyRef.current(postId);
  }, []);
  const requestDelete = useCallback((postId: string) => setDeleteTarget(postId), []);

  const controller: FeedController = useMemo(() => ({
    myId,
    replyCost: FEED_REPLY_COST,
    likesByPost,
    replyOpen,
    replyText: replyTextMap,
    replySending: replySendingMap,
    expanded: expandedThreads,
    onToggleLike: toggleLike,
    onToggleReplyBox: toggleReplyBox,
    onReplyTextChange: setReplyText,
    onRequestSend: requestSend,
    onToggleThread: toggleThread,
    onRequestDelete: requestDelete,
    onShare: sharePost,
  }), [
    myId, likesByPost, replyOpen, replyTextMap, replySendingMap, expandedThreads,
    toggleLike, toggleReplyBox, setReplyText, requestSend, toggleThread, requestDelete, sharePost,
  ]);

  return (
    <main className="min-h-screen theme-bg-gradient px-4 pb-28 pt-10">
      <div className="mx-auto max-w-xl">
        <BackButton />

        <div className="mb-7 mt-5">
          <h1 className="page-title">Public Feed</h1>
          <p className="page-subtitle mt-1">Real thoughts from the Whisper community. Posts clear after 24 hours.</p>
        </div>

        <GlassPanel strong className="mb-6 rounded-3xl p-5">
          <form onSubmit={createPost}>
            <textarea
              value={body}
              onChange={(event) => setBody(event.target.value)}
              maxLength={500}
              rows={3}
              placeholder="Share a thought with the Whisper community..."
              className="w-full resize-none bg-transparent text-sm outline-none"
              style={{ color: "var(--theme-text)" }}
            />

            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => setBody(SUGGESTED_POST)}
                className="glass-control min-w-0 flex-1 rounded-2xl px-3 py-2 text-left text-xs transition"
                style={{ color: "var(--theme-text-secondary)" }}
              >
                <span className="theme-accent-text font-bold">Suggestion:</span> {SUGGESTED_POST}
              </button>
              <button
                type="button"
                onClick={() => setShowAiSuggestions((visible) => !visible)}
                className="glass-control flex shrink-0 items-center gap-1.5 rounded-2xl px-3 py-2 text-xs font-bold transition"
                style={{ color: "var(--theme-accent-pink)" }}
                aria-expanded={showAiSuggestions}
              >
                <Sparkles size={14} /> AI Write
              </button>
            </div>

            {showAiSuggestions && (
              <div className="glass-control mt-3 grid gap-2 rounded-2xl p-2">
                {AI_SUGGESTIONS.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    onClick={() => { setBody(suggestion); setShowAiSuggestions(false); }}
                    className="glass-control rounded-xl px-3 py-2 text-left text-xs leading-5 transition"
                    style={{ color: "var(--theme-text-secondary)" }}
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            )}

            <div
              className="mt-3 flex items-center justify-between gap-3 border-t pt-3"
              style={{ borderColor: "var(--theme-border)" }}
            >
              <div className="min-w-0 text-xs theme-text-muted">
                <span className="block">Your Whisper link will be attached automatically.</span>
                {ownLink && <Link href={ownLink} className="theme-accent-text truncate">whisper.app{ownLink}</Link>}
              </div>
              <button
                type="submit"
                disabled={!cleanBody || posting || !ownLink}
                className="premium-button premium-button-primary flex shrink-0 items-center gap-2 rounded-2xl px-4 py-2.5 text-sm font-black disabled:opacity-50"
              >
                <Send size={15} />
                {/* The price is on the control that spends it. A cost that only
                    appears in the toast afterwards reads as a charge you weren't
                    told about, however small it is. */}
                {posting ? "Posting" : `Post · ${FEED_POST_COST}`}
                {!posting && <WhisperCoinIcon size={14} />}
              </button>
            </div>
          </form>
        </GlassPanel>

        {/* One surface, hairline-separated rows — the timeline is a column of
            text, not a stack of cards. See the `.feed-post` note in globals. */}
        <section aria-label="Public feed timeline">
          {loading ? (
            <FeedSkeleton />
          ) : postTree.length === 0 ? (
            <GlassPanel className="rounded-3xl p-10 text-center theme-text-muted">
              No posts yet. Start the conversation.
            </GlassPanel>
          ) : (
            postTree.map((post) => (
              <FeedPostCard
                key={post.id}
                node={post}
                controller={controller}
                depth={0}
                impressionRef={impressionRef}
              />
            ))
          )}
        </section>
      </div>

      {/* No reply confirmation any more. A dialog earns its place when an action
          spends money or destroys something; a free reply does neither, and
          asking twice made replying feel heavier than posting. The delete dialog
          below stays, because that one is irreversible. */}

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

/** Row-shaped placeholders, so the timeline doesn't reflow when posts land. */
function FeedSkeleton() {
  return (
    <div aria-hidden>
      {[0, 1, 2].map((row) => (
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
