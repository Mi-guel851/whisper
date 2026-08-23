"use client";

import { supabase } from "@/lib/supabase/client";
import { isOnline } from "@/lib/offline";
import type { FeedLike, FeedPost, FeedSort } from "@/lib/feed";

/**
 * Feed data access.
 *
 * Two paths, and the split matters:
 *
 *   RPC path       `public_feed_page` ranks, filters, paginates and personalises
 *                  server-side, over the whole window. This is the real feed.
 *   Fallback path  the original column-probing select against the table, which
 *                  is exactly what this screen did before. Ranking then happens
 *                  client-side over the loaded window.
 *
 * The fallback is not defensive padding — migrations in this project are applied
 * by hand, so between deploying this code and running the SQL there is a real
 * interval where the RPC does not exist. A feed that hard-depended on it would
 * be a blank screen for that whole interval.
 *
 * The two paths are mutually exclusive by construction: topics, photos and polls
 * all arrive in the same migration as the RPC, so if the RPC is missing those
 * columns are missing too and none of the new UI has anything to render. That is
 * why the fallback still probes only `parent_post_id` and `view_count` — there is
 * no state of the world where it needs to probe more.
 */

export const FEED_PAGE_SIZE = 10;

/**
 * Columns beyond the original feed schema.
 *
 * Support is probed per column, not as a prefix cascade. These ship in
 * independent migrations, so any combination of them can be missing — and an
 * earlier version dropped them from the end of this list one at a time, which
 * coupled them together. On a database missing only `view_count`, the first
 * retry discarded `parent_post_id` — the column that tells a reply from a post —
 * while keeping the column that actually didn't exist. The query failed again and
 * the feed fell all the way back to the bare table, so threading died because of
 * an unrelated missing column.
 */
const BASE_COLUMNS = "id,author_id,body,whisper_link,created_at,expires_at";
const OPTIONAL_COLUMNS = ["parent_post_id", "view_count"] as const;

/**
 * `image_path` is deliberately absent from every select in this file.
 *
 * Not because the bucket is unguarded — it is private, with no select policy at
 * all — but because the client has no use for the key: the bytes come from
 * /api/feed/photo by post id, which is where the view-once receipt and the
 * blocking check live. Withholding it is defence in depth, so a future component
 * cannot accidentally build a storage URL and route around either.
 *
 * It is not an anonymity measure, and it would be wrong to describe it as one:
 * `author_id` is in BASE_COLUMNS because the client needs it to render a stable
 * anonymous name and avatar per author, so correlating two posts to one author is
 * already possible by design. The pseudonym is the anonymity boundary here, not
 * the absence of the key.
 */

export type FeedQuery = {
  sort: FeedSort;
  topic: string | null;
  search: string;
};

export type FeedPageResponse =
  | { mode: "rpc"; rows: FeedPost[]; hasMore: boolean; stale?: boolean }
  /** The whole live window in one response, as before. The caller paginates it. */
  | { mode: "fallback"; rows: FeedPost[]; threaded: boolean };

/* --------------------------------------------------------------------------
 * The offline snapshot
 * ------------------------------------------------------------------------ */

const SNAPSHOT_PREFIX = "whisper-feed-snapshot:";

/**
 * How long a snapshot is worth showing. The feed itself only holds 24 hours, so
 * anything older than that is guaranteed to be entirely expired posts — showing
 * them would be presenting a feed of things that no longer exist.
 */
const SNAPSHOT_TTL_MS = 24 * 60 * 60 * 1000;

/** Search is excluded on purpose — see the note on `fetchFeedPage`. */
function snapshotKey(query: FeedQuery): string | null {
  if (query.search.trim()) return null;
  return `${SNAPSHOT_PREFIX}${query.sort}:${query.topic ?? "all"}`;
}

function cacheFirstPage(query: FeedQuery, offset: number, rows: FeedPost[]) {
  if (offset !== 0 || rows.length === 0) return;
  const key = snapshotKey(query);
  if (!key || typeof window === "undefined") return;

  try {
    window.localStorage.setItem(
      key,
      /* Capped: a snapshot exists to fill the first screen, not to mirror the
         feed. Twelve rows is more than fits on a phone. */
      JSON.stringify({ at: Date.now(), rows: rows.slice(0, 12) })
    );
  } catch {
    /* Quota, or storage denied in a private window. A missing snapshot is a
       normal state, so there is nothing to report. */
  }
}

function readFirstPage(query: FeedQuery): FeedPost[] | null {
  const key = snapshotKey(query);
  if (!key || typeof window === "undefined") return null;

  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as { at?: number; rows?: FeedPost[] };
    if (!parsed.at || !Array.isArray(parsed.rows)) return null;
    if (Date.now() - parsed.at > SNAPSHOT_TTL_MS) {
      window.localStorage.removeItem(key);
      return null;
    }
    return parsed.rows;
  } catch {
    return null;
  }
}

type QueryError = { code?: string; message?: string } | null;

/**
 * Whether an error means "this function/column isn't in the schema" as opposed to
 * "the request failed".
 *
 * The distinction decides whether to permanently downgrade to the fallback. A
 * dropped connection must not disable the RPC for the rest of the session, and a
 * genuinely absent function must not be retried on every scroll.
 */
function isMissingSchema(error: QueryError) {
  if (!error) return false;
  if (error.code === "42883" || error.code === "42703" || error.code === "PGRST202") return true;
  return /does not exist|could not find the function|schema cache/i.test(error.message ?? "");
}

/** Cached across calls: once we know, we stop asking. */
let rpcAvailable: boolean | null = null;

/** Exposed for the page's one-time "running in degraded mode" notice. */
export function isFeedRpcAvailable() {
  return rpcAvailable;
}

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

/** The original table select, kept intact. */
async function fetchWholeWindow(): Promise<{ rows: FeedPost[]; threaded: boolean }> {
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

  /* Probe each optional column alone, so one missing column cannot take an
     unrelated one down with it. `limit(1)` costs a schema check, not a copy of
     the feed. */
  const supported: string[] = [];
  for (const column of OPTIONAL_COLUMNS) {
    const { error } = await supabase.from("public_feed_posts").select(`id,${column}`).limit(1);
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

/**
 * One page of the feed.
 *
 * `offset` is only meaningful on the RPC path; the fallback returns the whole
 * window and the caller slices it, which is what it already did.
 *
 * OFFLINE
 *
 * Page 0 of each (sort, topic) view is written to localStorage on success and
 * replayed when the network cannot be reached, so opening the feed with no
 * connection shows the whispers you last saw rather than an empty state.
 *
 * Only page 0, and only when there is no search term. Deeper pages are a
 * continuation of a list whose head may now be stale, and a cached page 3 grafted
 * onto a fresh page 0 produces a feed with holes and repeats in it. A search is a
 * question about live data; answering it from a snapshot would be inventing
 * results.
 *
 * The feed needs this explicitly, unlike the rest of the app: every other screen
 * reads with `.select()`, which is a GET the service worker can cache on its own.
 * `public_feed_page` is an RPC — a POST — and POSTs are deliberately never cached
 * there, because that is also how coins are spent and photos are claimed.
 */
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
      cacheFirstPage(query, offset, rows);
      /* A short page is the end of the feed. Asking for a count as well would
         double the query cost to learn something the page length already says. */
      return { mode: "rpc", rows, hasMore: rows.length === limit };
    }

    if (isMissingSchema(error)) {
      console.warn("public_feed_page unavailable, using the direct table read:", error.message);
      rpcAvailable = false;
    } else {
      /* Transient. Fall through to the table read for this request only, so a
         blip degrades one page instead of the session. */
      console.warn("public_feed_page failed, retrying via the table:", error.message);
    }
  }

  const { rows, threaded } = await fetchWholeWindow();

  /* Nothing came back and there is no connection to explain it — so this is the
     offline case rather than a genuinely empty feed, and the snapshot is a better
     answer than a blank screen. Checked in this order deliberately: an empty feed
     on a working connection must still read as empty. */
  if (rows.length === 0 && !isOnline()) {
    const snapshot = readFirstPage(query);
    if (snapshot) return { mode: "rpc", rows: snapshot, hasMore: false, stale: true };
  }

  cacheFirstPage(query, offset, rows);
  return { mode: "fallback", rows, threaded };
}

/** Every reply under one root post, whole subtree. Null when unavailable. */
export async function fetchThread(postId: string): Promise<FeedPost[] | null> {
  if (rpcAvailable === false) return null;

  const { data, error } = await supabase.rpc("public_feed_thread", { p_post_id: postId });
  if (error) {
    if (isMissingSchema(error)) rpcAvailable = false;
    else console.warn("Thread fetch failed:", error.message);
    return null;
  }
  return (data || []) as FeedPost[];
}

/** Whisper of the Day. Null when nothing has been engaged with yet. */
export async function fetchSpotlight(): Promise<FeedPost | null> {
  if (rpcAvailable === false) return null;

  const { data, error } = await supabase.rpc("public_feed_spotlight");
  if (error) {
    if (isMissingSchema(error)) rpcAvailable = false;
    return null;
  }
  const rows = (data || []) as FeedPost[];
  return rows[0] ?? null;
}

/**
 * Surprise Me.
 *
 * `exclude` is everything already served this session, so pressing the button
 * repeatedly walks the feed rather than circling three posts. Null means there is
 * nothing left, and the caller resets the exclusion list.
 */
export async function fetchRandomPost(exclude: string[]): Promise<FeedPost | null> {
  if (rpcAvailable === false) return null;

  const { data, error } = await supabase.rpc("public_feed_random", { p_exclude: exclude });
  if (error) {
    if (isMissingSchema(error)) rpcAvailable = false;
    else console.warn("Random whisper failed:", error.message);
    return null;
  }
  const rows = (data || []) as FeedPost[];
  return rows[0] ?? null;
}

/** One post by id, for a shared `?post=` link that isn't in the loaded page. */
export async function fetchPostById(postId: string): Promise<FeedPost | null> {
  if (rpcAvailable !== false) {
    /* Reuses the ranked reader so blocking, reporting and expiry filters apply
       to a deep link exactly as they do to the timeline. */
    const { data, error } = await supabase.rpc("public_feed_page", {
      p_sort: "new",
      p_topic: null,
      p_search: null,
      p_limit: 50,
      p_offset: 0,
    });
    if (!error) {
      const match = ((data || []) as FeedPost[]).find((row) => row.id === postId);
      if (match) return match;
    } else if (isMissingSchema(error)) {
      rpcAvailable = false;
    }
  }

  const { data, error } = await supabase
    .from("public_feed_posts")
    .select([BASE_COLUMNS, ...OPTIONAL_COLUMNS].join(","))
    .eq("id", postId)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();

  if (error) return null;
  return (data as unknown as FeedPost) ?? null;
}

/** Like rows for the fallback path, where counts aren't computed server-side. */
export async function fetchLikes(postIds: string[]): Promise<FeedLike[]> {
  if (!postIds.length) return [];
  const { data, error } = await supabase
    .from("public_feed_likes")
    .select("post_id,user_id")
    .in("post_id", postIds);

  if (error) {
    console.warn("Feed likes fetch failed:", error.message);
    return [];
  }
  return (data || []) as FeedLike[];
}

/**
 * Casts or changes a poll vote and returns the authoritative tallies.
 *
 * The RPC does the writing so the primary key can be the duplicate-vote
 * protection, and it returns the counts so the client never has to guess at a
 * total it is about to render.
 */
export async function votePoll(
  postId: string,
  optionIndex: number
): Promise<{ counts: number[] } | { error: string }> {
  const { data, error } = await supabase.rpc("vote_public_feed_poll", {
    p_post_id: postId,
    p_option_index: optionIndex,
  });

  if (error) {
    return {
      error: isMissingSchema(error)
        ? "Polls aren't available on this server yet."
        : error.message,
    };
  }
  return { counts: (data || []) as number[] };
}

export type ReportReason = "spam" | "harassment" | "sexual" | "violence" | "self_harm" | "other";

/**
 * Files a report.
 *
 * Inserted straight from the client because the row is entirely the reporter's
 * own: RLS pins `reporter_id` to `auth.uid()`, refuses self-reports, and the
 * primary key makes a second report a no-op rather than a duplicate. A server
 * route would add a hop and enforce nothing the table doesn't already.
 */
export async function reportPost(
  postId: string,
  reporterId: string,
  reason: ReportReason,
  details: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await supabase.from("public_feed_reports").insert({
    post_id: postId,
    reporter_id: reporterId,
    reason,
    details: details.trim() ? details.trim().slice(0, 400) : null,
  });

  if (!error) return { ok: true };

  // Already reported. The outcome the user wanted is the outcome they have.
  if (error.code === "23505" || /duplicate key/i.test(error.message)) {
    return { ok: true };
  }
  if (isMissingSchema(error)) {
    return { ok: false, error: "Reporting isn't available on this server yet." };
  }
  return { ok: false, error: error.message };
}

/** Blocks an author from the viewer's feed, reusing the existing block table. */
export async function blockAuthor(
  authorId: string,
  myId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await supabase
    .from("blocked_users")
    .insert({ user_id: myId, blocked_user_id: authorId });

  if (!error) return { ok: true };
  if (/duplicate key/i.test(error.message)) return { ok: true };
  return { ok: false, error: error.message };
}
