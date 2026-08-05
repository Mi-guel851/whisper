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
};

export type FeedLike = { post_id: string; user_id: string };

export type FeedPostNode = FeedPost & { children: FeedPostNode[] };

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
  if (value < 1000) return String(value);
  if (value < 1_000_000) {
    return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0).replace(/\.0$/, "")}K`;
  }
  return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
}

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
