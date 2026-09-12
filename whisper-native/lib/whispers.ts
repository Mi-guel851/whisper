import { apiBase } from "./feed";
import { safeErrorMessage } from "./errors";
import { supabase } from "./supabase";
import type { Whisper, WhisperHint } from "./types";

/**
 * Received anonymous whispers — the `public.messages` inbox.
 *
 * This is the original Whisper: somebody opened your link and sent you
 * something with no name attached. The web app's `app/notifications/page.tsx`
 * renders exactly this query, and the native screen is a port of it.
 *
 * WHAT THE SENDER DOES NOT WRITE, AND WHY
 *
 * `messages.sender_user_id`, `sender_username` and `sender_email_name` exist as
 * columns and are deliberately left NULL. A Gmail local part with the digits
 * stripped is frequently enough to identify a sender outright, and a
 * client-supplied `sender_user_id` is an identity claim any sender could set to
 * somebody else's id — so the current app stores neither. Only the four coarse
 * context columns are written, and only the paid Hint reads them.
 */

/** The inbox query: everything sent to me, newest first. */
export async function fetchWhispers(recipientId: string): Promise<Whisper[]> {
  const { data, error } = await supabase
    .from("messages")
    .select("id,message,image_url,created_at,is_read")
    .eq("recipient_id", recipientId)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data || []) as Whisper[];
}

/** Marks one whisper read. RLS allows the recipient to update their own row. */
export async function markWhisperRead(messageId: string): Promise<void> {
  const { error } = await supabase.from("messages").update({ is_read: true }).eq("id", messageId);
  if (error) console.warn("[whispers] mark read failed:", error.message);
}

/* ---------------------------------------------------------------------------
 * Sending — the public profile page's whisper form
 * ------------------------------------------------------------------------ */

export type SenderContext = {
  country: string | null;
  state: string | null;
  city: string | null;
  device: string | null;
};

/**
 * Sends a whisper to a recipient.
 *
 * Two writes and a read, all of them the same as the web client's:
 *
 *  1. `messages.insert` with the text, an optional Cloudinary image URL, and
 *     the four coarse sender-context columns. Nothing that identifies the
 *     sender.
 *  2. The notification row for the recipient is written by the database's own
 *     trigger on `messages` — the client does not insert into `notifications`,
 *     and must not, or every whisper would be announced twice.
 *
 * The image, when there is one, is uploaded to Cloudinary first; the whisper
 * row only ever holds the resulting URL (see `lib/uploads.ts`).
 */
export async function sendWhisper(input: {
  recipientId: string;
  message: string;
  imageUrl?: string | null;
  context?: SenderContext;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const context = input.context ?? { country: null, state: null, city: null, device: null };

  const { error } = await supabase.from("messages").insert({
    recipient_id: input.recipientId,
    message: input.message.trim() ? input.message : null,
    image_url: input.imageUrl ?? null,
    sender_country: context.country,
    sender_state: context.state,
    sender_city: context.city,
    sender_device: context.device,
  });

  if (error) return { ok: false, error: safeErrorMessage(error, "Couldn't send that message.") };
  return { ok: true };
}

/**
 * Deletes whispers completely — the photo from Cloudinary, then the row.
 *
 * Through `/api/messages/delete` rather than a client `delete()`, because the
 * photo has to be reaped from Cloudinary with the service role and the
 * authorization (caller is the recipient) has to be checked somewhere the
 * client cannot influence. The route accepts `messageId` or `messageIds`, so
 * one row and a multi-select are the same request.
 */
export async function deleteWhispers(
  messageIds: string[],
  accessToken: string
): Promise<{ ok: boolean; error?: string }> {
  if (messageIds.length === 0) return { ok: true };

  try {
    const res = await fetch(`${apiBase()}/api/messages/delete`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(messageIds.length === 1 ? { messageId: messageIds[0] } : { messageIds }),
    });

    if (!res.ok) {
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      return { ok: false, error: json.error || "Couldn't delete that whisper." };
    }

    return { ok: true };
  } catch {
    return { ok: false, error: "Network error — nothing was deleted." };
  }
}

/* ---------------------------------------------------------------------------
 * Hints — the paid sender reveal
 * ------------------------------------------------------------------------ */

/** The message ids this user has already paid to reveal. */
export async function fetchHintUnlocks(userId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from("anonymous_sender_reveals")
    .select("message_id")
    .eq("user_id", userId);

  if (error) {
    console.warn("[whispers] unlock list failed:", error.message);
    return [];
  }
  return (data || []).map((row) => (row as { message_id: string }).message_id);
}

/**
 * The hints behind those unlocks.
 *
 * Fetched through `whisper_hints_for`, a definer RPC that refuses any message
 * without a matching reveal row. The columns are not readable from a client at
 * all any more (202609070001 revokes them on `messages`), which is why this is
 * a function call and not a select — a paywall enforced in the UI is not a
 * paywall.
 */
export async function fetchHints(messageIds: string[]): Promise<WhisperHint[]> {
  if (messageIds.length === 0) return [];

  const { data, error } = await supabase.rpc("whisper_hints_for", { p_message_ids: messageIds });
  if (error) {
    console.warn("[whispers] hint fetch failed:", error.message);
    return [];
  }
  return (data as WhisperHint[] | null) ?? [];
}

/** Spends the coins and unlocks a hint. Returns the new balance. */
export async function unlockHint(messageId: string): Promise<{ balance: number }> {
  const { data, error } = await supabase.rpc("unlock_hint_with_coins", { p_message_id: messageId });
  if (error) throw error;
  return { balance: Number(data ?? 0) };
}

/** Marks every unread whisper read in one request. */
export async function markAllWhispersRead(messageIds: string[]): Promise<void> {
  if (messageIds.length === 0) return;
  const { error } = await supabase.from("messages").update({ is_read: true }).in("id", messageIds);
  if (error) console.warn("[whispers] mark all read failed:", error.message);
}
