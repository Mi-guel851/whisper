import { isMissingSchema } from "./errors";
import { supabase } from "./supabase";
import type { FeedPost, FeedPostNode } from "./types";

/**
 * Public feed data access.
 *
 * A DIRECT PORT of the web app's `lib/feedApi.ts`. Two paths, and the split
 * matters for the same reason it does there:
 *
 *   RPC path       `public_feed_page` ranks, filters and paginates server-side,
 *                  over the whole 24-hour live window, and returns the
 *                  authoritative like/reply/view counts for this viewer.
 *   Fallback path  the original column-probing select against the table, with
 *                  ranking done client-side over the loaded window.
 *
 * The fallback is not padding. Migrations in this project are applied by hand,
 * so between shipping code and running SQL there is a real interval where the
 * RPC does not exist. A feed that hard-depended on it would be a blank screen
 * for that whole interval — which on a phone is indistinguishable from a crash.
 */

export const FEED_PAGE_SIZE = 10;

/** Cap for the fallback path: the whole window is held in memory and paged locally. */
const FEED_FALLBACK_MAX = 500;

const BASE_COLUMNS = "id,author_id,body,whisper_link,created_at,expires_at";
const OPTIONAL_COLUMNS = ["parent_post_id", "view_count", "author_role"] as const;

export type FeedSort = "for_you" | "trending" | "new" | "discussed";

export const FEED_SORTS: { key: FeedSort; label: string }[] = [
  { key: "for_you", label: "For You" },
  { key: "trending", label: "Trending" },
  { key: "new", label: "New" },
  { key: "discussed", label: "Discussed" },
];

/**
 * Topic slugs. These must stay in step with `public_feed_posts_topic_check`
 * (202608220003) — the constraint is the authority, and an unlisted slug is
 * rejected at insert rather than rendering as an unlabelled chip.
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

export function topicMeta(slug?: string | null) {
  return slug ? FEED_TOPICS.find((topic) => topic.key === slug) : undefined;
}

export type FeedQuery = {
  sort: FeedSort;
  topic: string | null;
  search: string;
};

export type FeedPageResponse =
  | { mode: "rpc"; rows: FeedPost[]; hasMore: boolean }
  | { mode: "fallback"; rows: FeedPost[]; threaded: boolean };

function rpcArgs(query: FeedQuery, limit: number, offset: number) {
  const search = query.search.trim();
  return {
    p_sort: query.sort,
    p_topic: query.topic,
    p_search: search.length ? search : null,
    p_limit: limit,
    p_offset: offset,
  };
}

/** The original table select, capped at the live window. */
async function fetchWholeWindow(): Promise<{ rows: FeedPost[]; threaded: boolean }> {
  const select = (columns: string) =>
    supabase
      .from("public_feed_posts")
      .select(columns)
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false })
      .limit(FEED_FALLBACK_MAX);

  const all = [BASE_COLUMNS, ...OPTIONAL_COLUMNS].join(",");
  const first = await select(all);

  if (!first.error) {
    return { rows: (first.data || []) as unknown as FeedPost[], threaded: true };
  }

  console.warn(`[feed] select failed with [${all}]:`, first.error.message);

  /* Probe each optional column alone, so one missing column cannot take an
     unrelated one down with it. `limit(1)` costs a schema check, not a copy. */
  const supported: string[] = [];
  for (const column of OPTIONAL_COLUMNS) {
    const { error } = await supabase.from("public_feed_posts").select(`id,${column}`).limit(1);
    if (!error) supported.push(column);
    else console.warn(`[feed] column [${column}] unavailable:`, error.message);
  }

  const columns = [BASE_COLUMNS, ...supported].join(",");
  const { data, error } = await select(columns);

  if (error) {
    console.error(`[feed] select failed with [${columns}]:`, error.message);
    return { rows: [], threaded: false };
  }

  return {
    rows: (data || []) as unknown as FeedPost[],
    threaded: supported.includes("parent_post_id"),
  };
}

/**
 * Whether `public_feed_page` exists. Cached across calls — once we know, we
 * stop asking. A dropped connection must not disable the RPC for the session,
 * and an absent function must not be retried on every scroll.
 */
let rpcAvailable: boolean | null = null;

export function isFeedRpcAvailable() {
  return rpcAvailable;
}

/* PostgREST caps a response at 1000 rows regardless of what `limit` asks for,
   so the fallback window is paged locally in slices of the same size. */
const FALLBACK_PAGE = 100;

/** One page of the feed. `offset` is only meaningful on the RPC path. */
export async function fetchFeedPage(
  query: FeedQuery,
  offset = 0,
  limit = FEED_PAGE_SIZE
): Promise<FeedPageResponse> {
  if (rpcAvailable !== false) {
    const { data, error } = await supabase.rpc("public_feed_page", rpcArgs(query, limit, offset));

    if (!error) {
      rpcAvailable = true;
      const rows = (data || []) as FeedPost[];
      return { mode: "rpc", rows, hasMore: rows.length === limit };
    }

    if (isMissingSchema(error)) {
      console.warn("[feed] public_feed_page unavailable, using the direct table read:", error.message);
      rpcAvailable = false;
    } else {
      /* Transient. Fall through to the table read for this request only, so a
         blip degrades one page instead of the session. */
      console.warn("[feed] public_feed_page failed, retrying via the table:", error.message);
    }
  }

  const { rows, threaded } = await fetchWholeWindow();
  return { mode: "fallback", rows, threaded };
}

/** The fallback's local slice, so a caller can page a whole-window response. */
export function sliceFallback(rows: FeedPost[], offset: number, limit = FALLBACK_PAGE) {
  return rows.slice(offset, offset + limit);
}

/**
 * One thread: the root post and its replies.
 *
 * `public_feed_thread` is authoritative when present (it caps the reply count
 * and computes per-row counts). The fallback reads the replies directly.
 */
export async function fetchThread(postId: string): Promise<FeedPost[]> {
  const { data, error } = await supabase.rpc("public_feed_thread", { p_post_id: postId });

  if (!error) return (data || []) as FeedPost[];

  if (!isMissingSchema(error)) console.warn("[feed] thread RPC failed:", error.message);

  const { data: replies } = await supabase
    .from("public_feed_posts")
    .select([BASE_COLUMNS, ...OPTIONAL_COLUMNS].join(","))
    .eq("parent_post_id", postId)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: true })
    .limit(200);

  return (replies || []) as unknown as FeedPost[];
}

/** A single post by id — used when a notification deep-links to one. */
export async function fetchPost(postId: string): Promise<FeedPost | null> {
  const { data, error } = await supabase
    .from("public_feed_posts")
    .select([BASE_COLUMNS, ...OPTIONAL_COLUMNS].join(","))
    .eq("id", postId)
    .maybeSingle();

  if (error) {
    console.warn("[feed] post fetch failed:", error.message);
    return null;
  }
  return (data as unknown as FeedPost) ?? null;
}

/** The signed-in user's own posts, newest first — the profile's "Your whispers". */
export async function fetchMyPosts(authorId: string, limit = 60): Promise<FeedPost[]> {
  const { data, error } = await supabase
    .from("public_feed_posts")
    .select([BASE_COLUMNS, ...OPTIONAL_COLUMNS].join(","))
    .eq("author_id", authorId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.warn("[feed] my posts fetch failed:", error.message);
    return [];
  }
  return (data || []) as unknown as FeedPost[];
}

/** Every post by an author, oldest first — used to build a thread from a raw list. */
export function buildPostTree(postList: FeedPost[]): FeedPostNode[] {
  const newestFirst = [...postList].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );

  const nodes = new Map<string, FeedPostNode>();
  for (const post of newestFirst) nodes.set(post.id, { ...post, children: [] });

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

  /* Replies read oldest-first, like a comment thread. */
  for (const node of nodes.values()) node.children.reverse();

  return roots;
}

/** Total descendants, so a root post can report its whole thread size. */
export function countDescendants(node: FeedPostNode): number {
  return node.children.reduce((total, child) => total + 1 + countDescendants(child), 0);
}

/* ---------------------------------------------------------------------------
 * Likes
 * ------------------------------------------------------------------------ */

/**
 * Toggles a like on a post.
 *
 * The row is the truth: `public_feed_likes` has `(post_id, user_id)` as its
 * key, and `public_feed_page` counts rows to produce `like_count`. The same
 * delete-or-insert the web client performs, so a like cast on the phone is the
 * same like the site sees.
 */
export async function toggleLike(postId: string, userId: string, liked: boolean): Promise<void> {
  if (liked) {
    const { error } = await supabase
      .from("public_feed_likes")
      .delete()
      .eq("post_id", postId)
      .eq("user_id", userId);
    if (error) throw error;
    return;
  }

  const { error } = await supabase.from("public_feed_likes").insert({ post_id: postId, user_id: userId });
  /* A duplicate key means the like already exists — the desired state, reached
     by a double tap or a retry. Not an error. */
  if (error && error.code !== "23505") throw error;
}

/** The viewer's liked ids, for a database without the RPC's `viewer_liked`. */
export async function fetchMyLikes(userId: string): Promise<Set<string>> {
  const { data, error } = await supabase
    .from("public_feed_likes")
    .select("post_id")
    .eq("user_id", userId)
    .limit(1000);

  if (error) {
    console.warn("[feed] likes fetch failed:", error.message);
    return new Set();
  }
  return new Set((data || []).map((row) => (row as { post_id: string }).post_id));
}

/* ---------------------------------------------------------------------------
 * Creating
 * ------------------------------------------------------------------------ */

export type CreatePostInput = {
  body: string;
  topic?: string | null;
  pollOptions?: string[] | null;
  imageUrl?: string | null;
  imagePreview?: string | null;
  parentPostId?: string | null;
};

/**
 * Creates a post or reply through `/api/coins/feed-post`.
 *
 * THE ONE ROUTE, NOT A CLIENT INSERT. That endpoint charges the 2-coin post fee
 * atomically, validates the topic/poll/photo against the table's own
 * constraints, looks up the author's `whisper_link`, and refunds the charge if
 * the insert fails. A client-side insert would have to reproduce all of that
 * and would be a second definition of the pricing rule. It is the same request
 * the web app makes, byte for byte, so the two clients cannot diverge on cost.
 */
export async function createFeedPost(
  input: CreatePostInput,
  accessToken: string
): Promise<{ post: FeedPost } | { error: string; status: number }> {
  const res = await fetch(`${apiBase()}/api/coins/feed-post`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      message: input.body,
      topic: input.topic ?? null,
      imagePath: input.imageUrl ?? null,
      imagePreview: input.imagePreview ?? null,
      pollOptions: input.pollOptions ?? null,
      parentPostId: input.parentPostId ?? null,
    }),
  });

  const json = (await res.json().catch(() => ({}))) as { post?: FeedPost; error?: string };

  if (!res.ok) {
    return { error: json.error || "Couldn't post that.", status: res.status };
  }
  if (!json.post) {
    return { error: "Couldn't post that.", status: res.status };
  }
  return { post: json.post };
}

/**
 * The deployment that owns the API routes.
 *
 * The feed's server routes live with the web app on Vercel, not on Supabase —
 * the coin ledger, the rate limiter and the Cloudinary ownership checks are all
 * in that codebase. This is the one place the native app reaches outside the
 * Supabase API, and it is deliberate: re-implementing the charge client-side is
 * the exact bug that route exists to prevent.
 */
export function apiBase(): string {
  return (process.env.EXPO_PUBLIC_API_BASE_URL || "https://whisper-anonymous.vercel.app").replace(/\/$/, "");
}

/* ---------------------------------------------------------------------------
 * View-once photos
 * ------------------------------------------------------------------------ */

/**
 * Claims a photo whisper — and spends the viewer's single look doing it.
 *
 * Through `/api/feed/photo` with the caller's JWT, never by building a URL out
 * of `image_path`. The route is where the rules live: an expired post answers
 * 410, the author is refused (they cannot spend their own photo), a viewer who
 * has already looked gets 410 too, and the view is recorded in the same request
 * that returns the bytes. A direct link would bypass every one of those.
 *
 * The response is raw bytes, so it is turned into a data URI — React Native's
 * `Image` cannot render a Blob, and writing to the filesystem first would leave
 * a view-once photo on disk, which is exactly what "view once" is promising not
 * to do.
 */
export async function claimFeedPhoto(
  postId: string,
  accessToken: string
): Promise<{ uri: string } | { error: string }> {
  try {
    const res = await fetch(`${apiBase()}/api/feed/photo`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ postId }),
    });

    if (!res.ok) {
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      return { error: json.error || "That photo isn't available." };
    }

    const contentType = res.headers.get("content-type") ?? "image/jpeg";
    const blob = await res.blob();
    const uri = await blobToDataUri(blob, contentType);
    return { uri };
  } catch {
    return { error: "Couldn't load that photo. Check your connection." };
  }
}

/** A `data:` URI for a blob. The only way to show bytes without touching disk. */
function blobToDataUri(blob: Blob, mimeType: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.readAsDataURL(blob);
  });
}

/* ---------------------------------------------------------------------------
 * Reporting / blocking — same tables the web app writes
 * ------------------------------------------------------------------------ */

export async function reportPost(postId: string, reporterId: string, reason: string): Promise<void> {
  const { error } = await supabase
    .from("public_feed_reports")
    .insert({ post_id: postId, reporter_id: reporterId, reason });
  if (error) throw error;
}

export async function blockAuthor(userId: string, authorId: string): Promise<void> {
  const { error } = await supabase
    .from("blocked_users")
    .insert({ user_id: userId, blocked_user_id: authorId });
  /* Already blocked is the desired state. */
  if (error && error.code !== "23505") throw error;
}

/**
 * Strips URLs from a post body.
 *
 * The feed attaches the author's own Whisper link automatically, so an
 * arbitrary link in the body is either a competing CTA or spam. Mirrors
 * `stripLinks` in the web app's lib/feed.ts.
 */
export function stripLinks(value: string): string {
  return value
    .replace(/(?:https?:\/\/|www\.)\S+/gi, "")
    .replace(/\b[a-z0-9-]+\.(?:com|net|org|app|io|co)\S*/gi, "")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/* --------------------------------------------------------------------------
 * Saved posts
 *
 * A save is a private pointer at a post, good for the rest of that post's
 * 24-hour life — `supabase/migrations/202608240002_saved_posts.sql` explains why
 * it is a pointer rather than an archive, and why the table is never summed.
 * The three calls mirror the web app's: toggle one, list mine, and mark which of
 * a page are already saved.
 * ------------------------------------------------------------------------ */

export type SavedPost = FeedPost & { saved_at: string };

let savesAvailable: boolean | null = null;

/**
 * True when saved posts are known to be missing from this database.
 *
 * The migration is applied by hand here, so the bookmark is hidden rather than
 * shown as a control that silently does nothing.
 */
export function areSavesAvailable(): boolean | null {
  return savesAvailable;
}

/**
 * Saves or unsaves a post. Returns the resulting state — `true` when it is now
 * saved — or `null` when the feature is not installed.
 *
 * One round trip and one source of truth: a client that inserted or deleted the
 * row itself would have to know the current state first, which is a second query
 * and a race with the same account on another device.
 */
export async function toggleSave(postId: string): Promise<boolean | null> {
  const { data, error } = await supabase.rpc("toggle_public_feed_save", {
    p_post_id: postId,
  });

  if (!error) {
    savesAvailable = true;
    return Boolean(data);
  }

  if (isMissingSchema(error)) {
    savesAvailable = false;
    return null;
  }
  throw new Error(error.message);
}

/**
 * The signed-in user's saved posts, newest save first. Every row is a `FeedPost`
 * with a `saved_at` on it, so the feed's own card renders it unchanged — a saved
 * copy that did not resemble the original would be a quietly broken screen.
 */
export async function fetchSavedPosts(
  offset = 0,
  limit = 20
): Promise<
  | { mode: "ok"; rows: SavedPost[]; hasMore: boolean }
  | { mode: "unavailable" }
> {
  const { data, error } = await supabase.rpc("public_feed_saved", {
    p_limit: limit,
    p_offset: offset,
  });

  if (error) {
    if (isMissingSchema(error)) {
      savesAvailable = false;
      return { mode: "unavailable" };
    }
    throw new Error(error.message);
  }

  savesAvailable = true;
  const rows = (data || []) as SavedPost[];
  return { mode: "ok", rows, hasMore: rows.length === limit };
}

/**
 * Which of these post ids the viewer has saved — one call for a page of the
 * feed, so the bookmarks render filled without a query per card.
 *
 * Empty set on any error: an unfilled bookmark is the safe default.
 */
export async function fetchSavedIds(postIds: string[]): Promise<Set<string>> {
  if (postIds.length === 0) return new Set();

  const { data, error } = await supabase.rpc("public_feed_saved_ids", {
    p_post_ids: postIds,
  });

  if (error) {
    if (isMissingSchema(error)) savesAvailable = false;
    return new Set();
  }

  savesAvailable = true;
  /* The RPC returns a set of uuids, which supabase-js delivers either as bare
     strings or as `{ public_feed_saved_ids: uuid }` rows. */
  return new Set(
    (data as unknown[]).map((row) =>
      typeof row === "string" ? row : (row as Record<string, string>).public_feed_saved_ids
    )
  );
}

/** The official Whisper account, as the database decides it. */
export function isCreatorPost(post: Pick<FeedPost, "author_role">): boolean {
  return post.author_role === "whisper_creator";
}

let spotlightAvailable: boolean | null = null;

/**
 * "Whisper of the Day" — the single post the day's engagement lifted highest.
 * Null when nothing has been engaged with yet, or when the server predates the
 * RPC (cached, the same way the page RPC is: an absent function must not be
 * retried on every refresh).
 */
export async function fetchSpotlight(): Promise<FeedPost | null> {
  if (spotlightAvailable === false) return null;

  const { data, error } = await supabase.rpc("public_feed_spotlight");
  if (error) {
    if (isMissingSchema(error)) spotlightAvailable = false;
    return null;
  }
  const rows = (data || []) as FeedPost[];
  return rows[0] ?? null;
}


export const OFFICIAL_IDENTITY = {
  name: "Whisper",
  handle: "@whisper",
} as const;
