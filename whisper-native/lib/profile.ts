import { forgetAnonName } from "./identity";
import { supabase } from "./supabase";
import type { Profile } from "./types";

/**
 * The profile row and the wallet.
 *
 * `profiles` is the one table the client writes freely (that is how the web
 * app's profile page saves a bio and `NotificationSettingsCard` flips switches)
 * — but two of its columns are guarded by a database trigger: `is_admin` and
 * `anon_name` cannot be set from a client, so this file never tries. Attempting
 * either would be rejected, and worse, would look like a feature.
 */

export const BIO_LIMIT = 140;
export const USERNAME_MIN = 3;

export async function fetchProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id,display_name,username,bio,avatar_url,anon_name,profile_completed,created_at")
    .eq("id", userId)
    .maybeSingle();

  if (error && error.code !== "PGRST116") {
    console.warn("[profile] fetch failed:", error.message);
  }
  return (data as Profile | null) ?? null;
}

/** The subset the settings screen toggles. */
export type NotificationPrefs = {
  push_notifications: boolean;
  notify_feed_posts: boolean;
  notify_replies: boolean;
  notify_friend_requests: boolean;
  notify_coin_transfers: boolean;
  notify_calls: boolean;
};

/** Defaults read as ON: NULL means on, matching `is distinct from false` in SQL. */
export const DEFAULT_PREFS: NotificationPrefs = {
  push_notifications: true,
  notify_feed_posts: true,
  notify_replies: true,
  notify_friend_requests: true,
  notify_coin_transfers: true,
  notify_calls: true,
};

export async function fetchNotificationPrefs(userId: string): Promise<NotificationPrefs> {
  const { data, error } = await supabase
    .from("profiles")
    .select(
      "push_notifications,notify_feed_posts,notify_replies,notify_friend_requests,notify_coin_transfers,notify_calls"
    )
    .eq("id", userId)
    .maybeSingle();

  if (error || !data) {
    /* A project without 202609100004 has none of the category columns; the
       global switch still exists from 202608190003, so ask for it alone. */
    const fallback = await supabase
      .from("profiles")
      .select("push_notifications")
      .eq("id", userId)
      .maybeSingle();

    const globalValue = (fallback.data as { push_notifications?: boolean | null } | null)?.push_notifications;
    return { ...DEFAULT_PREFS, push_notifications: globalValue !== false };
  }

  const next = { ...DEFAULT_PREFS };
  for (const key of Object.keys(DEFAULT_PREFS) as (keyof NotificationPrefs)[]) {
    next[key] = (data as Record<string, boolean | null>)[key] !== false;
  }
  return next;
}

/**
 * Saves one preference. Throws so the caller can roll its optimistic switch
 * back — a toggle that lies about the saved state is worse than one that takes
 * a beat.
 */
export async function saveNotificationPref(
  userId: string,
  key: keyof NotificationPrefs,
  value: boolean
): Promise<void> {
  const { error } = await supabase
    .from("profiles")
    .update({ [key]: value })
    .eq("id", userId);

  if (error) throw error;
}

export type ProfileEdit = {
  displayName?: string;
  username?: string;
  bio?: string;
  avatarUrl?: string | null;
};

export async function saveProfile(userId: string, edit: ProfileEdit): Promise<void> {
  const payload: Record<string, string | null> = {};

  if (edit.displayName !== undefined) payload.display_name = edit.displayName.trim() || null;
  if (edit.username !== undefined) payload.username = edit.username.trim().toLowerCase() || null;
  if (edit.bio !== undefined) payload.bio = edit.bio.trim().slice(0, BIO_LIMIT) || null;
  if (edit.avatarUrl !== undefined) payload.avatar_url = edit.avatarUrl;

  if (Object.keys(payload).length === 0) return;

  const { error } = await supabase.from("profiles").update(payload).eq("id", userId);
  if (error) throw error;
}

/** Marks the onboarding profile complete, as the web `/complete-profile` does. */
export async function completeProfile(userId: string, username: string, displayName: string): Promise<void> {
  const { error } = await supabase
    .from("profiles")
    .update({
      username: username.trim().toLowerCase(),
      display_name: displayName.trim() || username.trim(),
      profile_completed: true,
    })
    .eq("id", userId);

  if (error) throw error;
}

/** The sign-in-time check the web app uses to choose /dashboard vs /complete-profile. */
export async function isProfileComplete(userId: string): Promise<boolean> {
  const { data } = await supabase
    .from("profiles")
    .select("profile_completed")
    .eq("id", userId)
    .maybeSingle();

  return Boolean((data as { profile_completed?: boolean } | null)?.profile_completed);
}

/** Validates a username the way the web form does, before it ever hits the API. */
export function validateUsername(value: string): string | null {
  const username = value.trim().toLowerCase();
  if (username.length < USERNAME_MIN) return `Usernames are at least ${USERNAME_MIN} characters.`;
  if (username.length > 20) return "Keep usernames under 20 characters.";
  if (!/^[a-z0-9_]+$/.test(username)) return "Letters, numbers and underscores only.";
  return null;
}

/**
 * The user's public Whisper link — where anonymous messages are sent to them.
 *
 * `whisper.app/u/<username>` in the product's own copy (the landing page, the
 * link card, the AI assistant's answer), and the URL the web deployment
 * actually serves. Built from the deployment base so a self-hosted install
 * produces its own link rather than a Whisper one.
 */
export function whisperLink(username: string | null | undefined): string {
  const base = (process.env.EXPO_PUBLIC_SITE_URL || "https://whisper-anonymous.vercel.app").replace(/\/$/, "");
  return username ? `${base}/u/${username}` : `${base}/setup`;
}

/** The display form used in the UI: `whisper.app/u/name`. */
export function whisperLinkLabel(username: string | null | undefined): string {
  return username ? `whisper.app/u/${username}` : "Set a username to get your link";
}

/** Clears the cached anonymous name after an edit, so the next render re-reads. */
export function invalidateIdentity(userId: string) {
  forgetAnonName(userId);
}
