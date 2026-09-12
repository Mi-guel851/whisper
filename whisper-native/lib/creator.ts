import { apiBase } from "./feed";
import { supabase } from "./supabase";
import type { FeedPost } from "./types";

/**
 * Official posts — the native port of the web app's `lib/creator.ts` plus the
 * publish call from `app/creator/page.tsx`.
 *
 * The role is not a client claim: `author_role = 'whisper_creator'` is written
 * by the database only, and the publish route re-verifies the session's
 * account with `is_whisper_creator()` server-side before it stores anything.
 * The client's only job is to *show* the right identity and give the creator a
 * way to publish — an impostor who edits this file changes nothing.
 */

/**
 * One copy of the role rules lives in `lib/feed.ts` (the readers' module);
 * these re-exports keep the creator surface importing from here, the way the
 * web app's `lib/creator.ts` is the single import site.
 */
export { isCreatorPost, OFFICIAL_IDENTITY } from "./feed";

/** Value for every official Whisper post. Written by the database only. */
export const CREATOR_ROLE = "whisper_creator" as const;

/** Value for every ordinary whisper. Also the column default. */
export const USER_ROLE = "user" as const;

export type AuthorRole = typeof CREATOR_ROLE | typeof USER_ROLE;

export type CreatorAccess =
  | { state: "checking" }
  | { state: "no" }
  | { state: "yes"; userId: string }
  | { state: "unavailable" };

/**
 * Whether the signed-in account may publish official posts — the web app's
 * `useCreatorAccess`, resolved from the `is_whisper_creator` RPC. `false`
 * because the RPC is missing (an older database) is "unavailable", not "no":
 * the screen should say so rather than accuse the user.
 */
export async function checkCreatorAccess(): Promise<CreatorAccess> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return { state: "no" };

  const { data, error } = await supabase.rpc("is_whisper_creator");
  if (error) {
    console.warn("[creator] is_whisper_creator unavailable:", error.message);
    return { state: "unavailable" };
  }
  return data === true ? { state: "yes", userId: session.user.id } : { state: "no" };
}

/**
 * Publish an official post — the same call the web's creator dashboard makes
 * (`POST /api/creator/post` with the session's bearer token). Only the content
 * goes over the wire: there is no role, flag or identity field to send — the
 * server derives all of that from the session.
 */
export async function publishOfficialPost(input: {
  message: string;
  /** The Cloudinary public id of an uploaded photo (`public_id` from the
     upload response) — the route verifies it exists before storing it. */
  imagePath?: string | null;
  imagePreview?: string | null;
}): Promise<FeedPost> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error("Sign in to publish.");

  const res = await fetch(`${apiBase()}/api/creator/post`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({
      message: input.message,
      imagePath: input.imagePath ?? null,
      imagePreview: input.imagePreview ?? null,
    }),
  });

  const json = (await res.json().catch(() => ({}))) as { error?: string; post?: FeedPost };
  if (!res.ok || !json.post) {
    throw new Error(json.error || "Couldn't publish that.");
  }
  return json.post;
}
