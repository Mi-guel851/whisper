/**
 * Official Whisper Creator — shared, client-safe constants and pure helpers.
 *
 * Nothing in this file *grants* anything. Authorisation lives in the database:
 * `public.is_whisper_creator()` reads the confirmed email of the authenticated
 * user against `public.whisper_creator_emails`, and the `author_role` column is
 * guarded by a trigger and RLS (see supabase/migrations/202609060001). What is
 * here is only the vocabulary both sides share — the role value, the official
 * display identity, and the predicate the feed uses to decide *how to draw* a
 * row it has already been handed by a trusted reader.
 *
 * The allowlist itself is deliberately NOT duplicated here. A client-side copy
 * would be one more place to keep in step and would tempt a future check of the
 * form `user.email === ...`, which is precisely the thing that must never be the
 * authorisation.
 */

/** Value of `public_feed_posts.author_role` for an official post. */
export const CREATOR_ROLE = "whisper_creator" as const;
/** Value for every ordinary whisper. Also the column default. */
export const USER_ROLE = "user" as const;

export type AuthorRole = typeof CREATOR_ROLE | typeof USER_ROLE;

/** The identity every official post renders under. */
export const OFFICIAL_IDENTITY = {
  name: "Whisper",
  badge: "Official",
  /** The app mark. Ordinary users cannot pick this — avatars are generated
   *  from the user id (lib/generatedAvatar.ts), never chosen. */
  avatarSrc: "/ghost.png",
} as const;

/** Route of the creator-only dashboard. */
export const CREATOR_ROUTE = "/creator";

/**
 * Whether a row from the feed is an official creator post.
 *
 * The only input is the `author_role` column as returned by the database
 * readers (`public_feed_page`, `public_feed_thread`, `public_feed_saved`, the
 * realtime payload). The database refuses to store that value for anyone who is
 * not a creator, so trusting it here is trusting the database — not the client.
 */
export function isCreatorPost(post: { author_role?: string | null } | null | undefined): boolean {
  return post?.author_role === CREATOR_ROLE;
}
