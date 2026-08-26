/**
 * Public feed domain logic.
 *
 * Pure functions only — no React, no Supabase. The feed page and the feed
 * components both need the shape of a thread, and neither should own it.
 */

export type FeedPost = {
  id: string;
  author_id: string;
  body: string;
  whisper_link: string;
  created_at: string;
  expires_at: string;
  parent_post_id?: string | null;
  view_count?: number | null;

  /* ---------------------------------------------------------------------
     Everything below arrives from the `public_feed_page` RPC and is optional
     for one reason: on a database where the premium feed migration has not
     been applied yet, the page falls back to selecting the table directly and
     these are simply absent. Every consumer treats undefined as "not
     available" rather than as zero, so a partial database degrades the feed
     instead of breaking it.
     --------------------------------------------------------------------- */

  topic?: string | null;
  /** True when a photo exists. The storage key itself is never sent to the
   *  browser — bytes come from /api/feed/photo, once per viewer. */
  has_image?: boolean | null;
  /** A ~24px blurred JPEG as a data URI. This is the whole preview. */
  image_preview?: string | null;
  poll_options?: string[] | null;
  poll_counts?: number[] | null;

  like_count?: number | null;
  reply_count?: number | null;
  viewer_liked?: boolean | null;
  viewer_image_viewed?: boolean | null;
  viewer_vote?: number | null;
  rank_score?: number | null;
};

export type FeedLike = { post_id: string; user_id: string };

export type FeedPostNode = FeedPost & { children: FeedPostNode[] };

/** The four tabs. `for_you` is the default because it is the only one that
 *  improves the longer somebody uses the app. */
export const FEED_SORTS = [
  { key: "for_you", label: "For You" },
  { key: "trending", label: "Trending" },
  { key: "new", label: "New" },
  { key: "discussed", label: "Discussed" },
] as const;

export type FeedSort = (typeof FEED_SORTS)[number]["key"];

/**
 * Topic slugs.
 *
 * These must stay in step with `public_feed_posts_topic_check` in
 * supabase/migrations/202608220003_public_feed_premium.sql — the constraint is
 * the authority, and an unlisted slug is rejected at insert rather than
 * rendering as an unlabelled chip.
 */
export const FEED_TOPICS = [
  { key: "confession", label: "Confession", emoji: "🤐" },
  { key: "advice", label: "Advice", emoji: "🧭" },
  { key: "love", label: "Love", emoji: "💜" },
  { key: "vent", label: "Vent", emoji: "🌧️" },
  { key: "funny", label: "Funny", emoji: "😂" },
  { key: "deep", label: "Deep", emoji: "🌌" },
  { key: "question", label: "Question", emoji: "❓" },
  { key: "random", label: "Random", emoji: "🎲" },
] as const;

export type FeedTopic = (typeof FEED_TOPICS)[number]["key"];

const TOPIC_LOOKUP = new Map(FEED_TOPICS.map((topic) => [topic.key, topic]));

export function topicMeta(slug?: string | null) {
  return slug ? TOPIC_LOOKUP.get(slug as FeedTopic) : undefined;
}

/**
 * Strips URLs from a post body.
 *
 * The feed attaches the author's own Whisper link automatically, so an
 * arbitrary link in the body is either a competing CTA or spam.
 */
export function stripLinks(value: string) {
  return value
    .replace(/(?:https?:\/\/|www\.)\S+/gi, "")
    .replace(/\b[a-z0-9-]+\.(?:com|net|org|app|io|co)\S*/gi, "")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/** Compact relative time, Twitter style: 45s, 12m, 5h, 3d. */
export function timeAgo(value: string) {
  const seconds = Math.max(1, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export function compactCount(value: number) {
  return formatCount(value);
}

// Single source of truth for engagement number formatting.
import { formatCount, formatFullCount } from "./formatCount";
export { formatCount, formatFullCount };

/**
 * Folds a flat post list into threads.
 *
 * A reply is any row carrying `parent_post_id`. It is deliberately *not*
 * returned as a root: replies used to surface as standalone posts, so the same
 * sentence appeared twice in the feed — once as its own card, once under the
 * post it answered.
 *
 * A reply whose parent has expired out of the window is dropped rather than
 * promoted to a root. Promoting it is what makes an orphaned reply read as a
 * cryptic top-level post with no context, which is the bug in a subtler form.
 */
export function buildPostTree(postList: FeedPost[]): FeedPostNode[] {
  const newestFirst = [...postList].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );

  const nodes = new Map<string, FeedPostNode>();
  for (const post of newestFirst) {
    nodes.set(post.id, { ...post, children: [] });
  }

  const roots: FeedPostNode[] = [];
  for (const post of newestFirst) {
    const node = nodes.get(post.id);
    if (!node) continue;

    if (post.parent_post_id) {
      nodes.get(post.parent_post_id)?.children.push(node);
      continue;
    }

    roots.push(node);
  }

  // Replies read oldest-first, like a comment thread.
  for (const node of nodes.values()) {
    node.children.reverse();
  }

  return roots;
}

/** Total descendants, so a root post can report its whole thread size. */
export function countDescendants(node: FeedPostNode): number {
  return node.children.reduce((total, child) => total + 1 + countDescendants(child), 0);
}

export function upsertPost(current: FeedPost[], incoming: FeedPost) {
  return current.some((item) => item.id === incoming.id)
    ? current.map((item) => (item.id === incoming.id ? incoming : item))
    : [incoming, ...current];
}

/* =========================================================================
   Daily Question
   ========================================================================= */

/**
 * The prompt rotation. One per day, and the list is prime-length relative to 7
 * so the same question never lands on the same weekday twice in a row.
 */
const DAILY_QUESTIONS = [
  "What's something you've never told anyone?",
  "What would you do differently if nobody was watching?",
  "Who are you still not over?",
  "What's the kindest thing a stranger has done for you?",
  "What are you pretending not to know?",
  "What's the last thing that made you cry?",
  "What compliment do you never believe?",
  "What are you most afraid people will find out?",
  "What did you need to hear five years ago?",
  "What's a small thing that instantly ruins your day?",
  "Who do you miss but would never text?",
  "What are you proud of that nobody knows about?",
  "What's the lie you tell most often?",
  "What do you wish you could say to your younger self?",
  "What's keeping you up lately?",
  "What's something everyone else seems to enjoy but you don't?",
  "When did you last feel genuinely proud of yourself?",
  "What's a rule you break constantly?",
  "What do you want but feel guilty for wanting?",
  "What's the nicest thing you've ever done anonymously?",
  "Who changed your life in a single conversation?",
  "What's your most irrational fear?",
  "What are you still angry about?",
  "What's something you've forgiven but not forgotten?",
  "What would your closest friend be surprised to learn?",
  "What's the best advice you've ignored?",
  "What do you do when nobody's home?",
  "What's a moment you'd relive exactly as it happened?",
  "What are you putting off, and why?",
  "What do you hope happens this year?",
  "What's the hardest thing you've had to accept?",
] as const;

/**
 * The question for a given day.
 *
 * Indexed on the UTC date rather than the local one, so the Daily Question is
 * genuinely the same question everywhere at once — the feed is one global room,
 * and a prompt that differs by timezone would put two conversations in it.
 */
export function dailyQuestionFor(date: Date = new Date()) {
  const dayIndex = Math.floor(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) / 86_400_000
  );
  return DAILY_QUESTIONS[((dayIndex % DAILY_QUESTIONS.length) + DAILY_QUESTIONS.length) % DAILY_QUESTIONS.length];
}

/* =========================================================================
   Ranking — the fallback path
   ========================================================================= */

/**
 * Sorts posts the way `public_feed_page` would.
 *
 * The server is the fast path and the authority; this exists for the database
 * where the premium feed migration has not been applied, so the tabs still do
 * what they say instead of silently all showing the newest posts. It works over
 * the rows already loaded, which is the honest limit of a client-side sort —
 * the tab is right about the window it can see.
 *
 * The weights deliberately mirror the SQL. Two rankers that disagree would mean
 * the tab reorders itself the moment the migration lands.
 */
export function rankFeedPosts(
  posts: FeedPostNode[],
  sort: FeedSort,
  context: { likesByPost: Record<string, FeedLike[]>; myId?: string }
): FeedPostNode[] {
  if (sort === "new") {
    return [...posts].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
  }

  const now = Date.now();
  const RECENT_WINDOW = 6 * 60 * 60 * 1000;

  /* Which topics this viewer keeps liking. Same signal the SQL uses, read from
     the likes already in memory. */
  const affinity = new Map<string, number>();
  if (context.myId) {
    for (const post of posts) {
      if (!post.topic) continue;
      const mine = (context.likesByPost[post.id] ?? []).some((l) => l.user_id === context.myId);
      if (mine) affinity.set(post.topic, (affinity.get(post.topic) ?? 0) + 1);
    }
  }

  const scored = posts.map((post) => {
    const likes = context.likesByPost[post.id] ?? [];
    const likesTotal = post.like_count ?? likes.length;
    const replies = post.reply_count ?? countDescendants(post);
    const recentReplies = countRecentDescendants(post, now - RECENT_WINDOW);
    const ageHours = Math.max(0.25, (now - new Date(post.created_at).getTime()) / 3_600_000);

    /* Likes carry no timestamp on the client, so "recent likes" can only be
       approximated by the post's own age. A like on a two-hour-old post is at
       most two hours old, which is a sound bound rather than a guess. */
    const likesRecent = ageHours <= 6 ? likesTotal : 0;

    const heat =
      (likesRecent * 3 +
        recentReplies * 5 +
        likesTotal * 0.6 +
        replies * 1 +
        (post.view_count ?? 0) * 0.05 +
        0.5) /
      Math.pow(ageHours + 2, 1.35);

    let score: number;
    if (sort === "trending") {
      score = heat;
    } else if (sort === "discussed") {
      score = replies * 1000 + recentReplies * 50 + new Date(post.created_at).getTime() / 1e12;
    } else {
      const hits = post.topic ? (affinity.get(post.topic) ?? 0) : 0;
      score = heat * (1 + Math.min(0.8, hits * 0.2));
    }

    return { post, score };
  });

  return scored
    .sort(
      (a, b) =>
        b.score - a.score ||
        new Date(b.post.created_at).getTime() - new Date(a.post.created_at).getTime()
    )
    .map((entry) => entry.post);
}

/** Descendants created after `since`, counted through the whole subtree. */
function countRecentDescendants(node: FeedPostNode, since: number): number {
  return node.children.reduce(
    (total, child) =>
      total +
      (new Date(child.created_at).getTime() > since ? 1 : 0) +
      countRecentDescendants(child, since),
    0
  );
}

/* =========================================================================
   Sharing
   ========================================================================= */

export type ShareTarget = "whatsapp" | "x" | "facebook";

/**
 * The outbound URL for one share target.
 *
 * Facebook's sharer takes only a URL — it reads the page's Open Graph tags for
 * the text, so passing a quote is pointless there and is deliberately omitted
 * rather than appended where it would be dropped.
 */
export function shareTargetUrl(target: ShareTarget, text: string, url: string) {
  switch (target) {
    case "whatsapp":
      return `https://wa.me/?text=${encodeURIComponent(`${text}\n\n${url}`)}`;
    case "x":
      return `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
    case "facebook":
      return `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`;
  }
}

/** A short, quotable excerpt — enough to carry the whisper, not the whole post. */
export function shareExcerpt(body: string, limit = 160) {
  const clean = stripLinks(body).replace(/\s+/g, " ").trim();
  if (clean.length <= limit) return clean;
  return `${clean.slice(0, limit - 1).trimEnd()}…`;
}
