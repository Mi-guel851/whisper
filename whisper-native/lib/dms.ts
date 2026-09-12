import { safeErrorMessage } from "./errors";
import { supabase } from "./supabase";
import { CLOUDINARY_FOLDERS, discardUpload, uploadImage, type LocalImage, type UploadedAsset } from "./uploads";
import type { ConversationRow, DirectMessage, VoiceRecording } from "./types";

/**
 * Direct messages — `conversations` + `direct_messages`.
 *
 * NAMING, BECAUSE IT IS THE EASIEST THING TO GET WRONG IN THIS APP
 *
 *   `messages`           anonymous whispers sent through a user's public link.
 *                        No conversation, no reply, no sender identity.
 *   `conversations`      a pair of users (`user_a`, `user_b`) with per-side
 *   `direct_messages`    read stamps and a last-message denormalisation.
 *
 * Everything in this file is the conversation side, and every query is the one
 * the web app's `app/inbox/page.tsx` and `app/chat/[conversationId]/page.tsx`
 * run — including the RPC-first-with-fallback shape, which exists because the
 * migrations are applied by hand.
 */

const CONVERSATION_COLUMNS =
  "id, user_a, user_b, user_a_last_read_at, user_b_last_read_at, last_message_at, last_message_sender_id";

/** The deployment serving `/api/*`, same default as the web client's own base. */
function apiBase(): string {
  return (process.env.EXPO_PUBLIC_API_BASE_URL ?? "https://whisper-anonymous.vercel.app").replace(
    /\/$/,
    ""
  );
}

/** The message columns every read shares. */
const MESSAGE_COLUMNS =
  "id,conversation_id,sender_id,content,created_at,is_view_once,image_path,image_viewed_at," +
  "audio_path,audio_viewed_at,audio_duration_ms,audio_waveform,audio_mime,media_url,media_kind," +
  "media_width,media_height,delivered_at,read_at,reply_to_id";

/* ---------------------------------------------------------------------------
 * The conversation list
 * ------------------------------------------------------------------------ */

/**
 * The inbox, sorted by real activity.
 *
 * `inbox_conversations()` ranks by the true latest message before applying its
 * 300-row cap, which matters: a denormalised `last_message_at` can be stale if
 * an older client or an interrupted write left it behind, and a conversation
 * list sorted by a stale column puts the thread that just spoke to you below
 * one that went quiet last week. The table query stays as the deploy-order
 * fallback so an unmigrated project still opens the inbox.
 */
export async function fetchConversations(userId: string): Promise<ConversationRow[]> {
  const { data: exact, error: exactError } = await supabase.rpc("inbox_conversations");

  if (!exactError && exact) return exact as ConversationRow[];

  if (exactError) {
    console.warn("[dms] inbox_conversations unavailable, using the table:", exactError.message);
  }

  const { data, error } = await supabase
    .from("conversations")
    .select(CONVERSATION_COLUMNS)
    .or(`user_a.eq.${userId},user_b.eq.${userId}`)
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(300);

  if (error) throw error;
  return (data || []) as ConversationRow[];
}

/**
 * The newest message in each conversation, keyed by conversation id.
 *
 * `inbox_message_previews` is one exact row per conversation. The fallback is
 * the old windowed read — 600 newest rows across every conversation — which is
 * correct unless one heavy thread fills the whole window, in which case the
 * quieter threads get no preview at all.
 */
export async function fetchPreviews(
  conversationIds: string[]
): Promise<Record<string, DirectMessage>> {
  if (conversationIds.length === 0) return {};

  const { data: rpcRows, error: rpcError } = await supabase.rpc("inbox_message_previews", {
    p_conversation_ids: conversationIds,
  });

  let rows = (rpcRows as DirectMessage[] | null) ?? null;

  if (rpcError || rows === null || (conversationIds.length > 0 && rows.length === 0)) {
    if (rpcError) console.warn("[dms] preview RPC unavailable, windowing:", rpcError.message);

    const { data } = await supabase
      .from("direct_messages")
      .select(MESSAGE_COLUMNS)
      .in("conversation_id", conversationIds)
      .order("created_at", { ascending: false })
      .limit(600);

    rows = (data || []) as unknown as DirectMessage[];
  }

  const latest: Record<string, DirectMessage> = {};
  for (const message of rows || []) {
    if (!latest[message.conversation_id]) latest[message.conversation_id] = message;
  }
  return latest;
}

/**
 * Unread counts, one row per conversation.
 *
 * The old shape fetched every unread message ROW and counted them in JS, so a
 * 10k-message backlog pulled 10k rows on every inbox paint. The RPC does the
 * count in the database; the fallback keeps an unmigrated project working.
 */
export async function fetchUnreadCounts(
  conversationIds: string[],
  userId: string
): Promise<Record<string, number>> {
  if (conversationIds.length === 0) return {};

  const { data, error } = await supabase.rpc("unread_message_counts", {
    conversation_ids: conversationIds,
  });

  const counts: Record<string, number> = {};

  if (!error && data) {
    for (const row of data as { conversation_id: string; unread: number }[]) {
      counts[row.conversation_id] = Number(row.unread) || 0;
    }
    return counts;
  }

  if (error) console.warn("[dms] unread RPC unavailable, counting rows:", error.message);

  const { data: rows } = await supabase
    .from("direct_messages")
    .select("conversation_id")
    .in("conversation_id", conversationIds)
    .neq("sender_id", userId)
    .is("read_at", null);

  for (const row of rows || []) {
    const id = (row as { conversation_id: string }).conversation_id;
    counts[id] = (counts[id] || 0) + 1;
  }
  return counts;
}

/** The participant on the other side of a conversation. */
export function otherParticipant(conversation: ConversationRow, userId: string): string {
  return conversation.user_a === userId ? conversation.user_b : conversation.user_a;
}

/** Which read-stamp column belongs to this user. */
export function readColumnFor(
  conversation: ConversationRow,
  userId: string
): "user_a_last_read_at" | "user_b_last_read_at" {
  return conversation.user_a === userId ? "user_a_last_read_at" : "user_b_last_read_at";
}

/* ---------------------------------------------------------------------------
 * One conversation
 * ------------------------------------------------------------------------ */

export async function fetchConversation(conversationId: string): Promise<ConversationRow | null> {
  const { data, error } = await supabase
    .from("conversations")
    .select(CONVERSATION_COLUMNS)
    .eq("id", conversationId)
    .maybeSingle();

  if (error) {
    if (error.code !== "PGRST116") console.warn("[dms] conversation fetch failed:", error.message);
    return null;
  }
  return (data as ConversationRow) ?? null;
}

/**
 * The transcript, newest page first.
 *
 * Fetched descending so a long thread returns its most recent messages rather
 * than its oldest, then reversed for display. `limit` is the page; the caller
 * loads more by asking for the slice before the oldest it holds.
 */
export async function fetchMessages(
  conversationId: string,
  limit = 60,
  before?: string | null
): Promise<DirectMessage[]> {
  let query = supabase
    .from("direct_messages")
    .select(MESSAGE_COLUMNS)
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (before) query = query.lt("created_at", before);

  const { data, error } = await query;
  if (error) {
    console.warn("[dms] message fetch failed:", error.message);
    return [];
  }

  return ((data || []) as unknown as DirectMessage[]).reverse();
}

/** One message by id — used to reconcile a realtime insert. */
export async function fetchMessage(messageId: string): Promise<DirectMessage | null> {
  const { data } = await supabase.from("direct_messages").select(MESSAGE_COLUMNS).eq("id", messageId).maybeSingle();
  return (data as unknown as DirectMessage) ?? null;
}

/* ---------------------------------------------------------------------------
 * Sending
 * ------------------------------------------------------------------------ */

/** A plain text DM. The notification row is written by the database trigger. */
export async function sendMessage(input: {
  conversationId: string;
  senderId: string;
  content: string;
  replyToId?: string | null;
}): Promise<{ ok: true; message: DirectMessage } | { ok: false; error: string }> {
  const { data, error } = await supabase
    .from("direct_messages")
    .insert({
      conversation_id: input.conversationId,
      sender_id: input.senderId,
      content: input.content,
      reply_to_id: input.replyToId ?? null,
    })
    .select(MESSAGE_COLUMNS)
    .single();

  if (error) {
    return { ok: false, error: safeErrorMessage(error, "Couldn't send that message.") };
  }
  return { ok: true, message: data as unknown as DirectMessage };
}

/**
 * Sends a view-once photo, in the order the web client sends one.
 *
 *   1. Upload to `view-once/<sender id>/…`. That owner segment is what
 *      `/api/cloudinary/destroy` reads to decide who may delete the asset, which
 *      is why the rollback below can clean up after a failed send and nobody
 *      else can.
 *   2. `spend_coins_for_image` charges the 10 coins. The charge is a separate
 *      RPC because the insert has to happen *after* it — an insert-then-charge
 *      leaves a free photo in the thread whenever the charge fails.
 *   3. Insert the message with `image_path` holding the Cloudinary URL and
 *      `is_view_once` true. `/api/photos/view` is the only reader of that
 *      column, and it nulls it and destroys the asset on the single view.
 *
 * A failed charge discards the upload before returning, so a rejected send
 * leaves nothing behind in the Cloudinary account.
 */
export async function sendPhotoMessage(input: {
  conversationId: string;
  senderId: string;
  image: LocalImage;
  accessToken: string;
  caption?: string | null;
  replyToId?: string | null;
}): Promise<{ ok: true; message: DirectMessage } | { ok: false; error: string }> {
  let uploaded: UploadedAsset;

  try {
    uploaded = await uploadImage(input.image, `${CLOUDINARY_FOLDERS.viewOnce}/${input.senderId}`, input.accessToken);
  } catch (cause) {
    return { ok: false, error: safeErrorMessage(cause, "Couldn't upload that photo.") };
  }

  const { error: spendError } = await supabase.rpc("spend_coins_for_image", {
    target_conversation_id: input.conversationId,
  });

  if (spendError) {
    await discardUpload(uploaded.url, input.accessToken);
    return { ok: false, error: safeErrorMessage(spendError, "You don't have enough coins for that.") };
  }

  const { data, error } = await supabase
    .from("direct_messages")
    .insert({
      conversation_id: input.conversationId,
      sender_id: input.senderId,
      content: input.caption?.trim() ? input.caption.trim() : null,
      reply_to_id: input.replyToId ?? null,
      image_path: uploaded.url,
      is_view_once: true,
    })
    .select(MESSAGE_COLUMNS)
    .single();

  if (error) {
    /* The coins are already spent at this point and the web client does not
       refund either — the ledger row is the record of what happened, and a
       client-side refund would be a second write to a balance the server owns. */
    return { ok: false, error: safeErrorMessage(error, "Couldn't send that photo.") };
  }

  return { ok: true, message: data as unknown as DirectMessage };
}

/** A sticker or GIF — an ordinary DM carrying `media_url` + `media_kind`. */
export async function sendMediaMessage(input: {
  conversationId: string;
  senderId: string;
  kind: "gif" | "sticker";
  url: string;
  width?: number | null;
  height?: number | null;
  replyToId?: string | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await supabase.from("direct_messages").insert({
    conversation_id: input.conversationId,
    sender_id: input.senderId,
    content: null,
    reply_to_id: input.replyToId ?? null,
    media_url: input.url,
    media_kind: input.kind,
    media_width: input.width ?? null,
    media_height: input.height ?? null,
  });

  if (error) return { ok: false, error: safeErrorMessage(error, "Couldn't send that.") };
  return { ok: true };
}

/**
 * Uploads and sends a voice note, in the order the database insists on.
 *
 *  1. The object goes into the private `voice-messages` bucket at
 *     `<conversation_id>/<uuid>.<ext>`. That first path segment is not
 *     decorative: the bucket's storage policies parse it back out to decide
 *     whether the caller is a participant, so a note uploaded under a different
 *     prefix is refused.
 *  2. `send_voice_note` creates the message row, charges the coins and stores
 *     the waveform in one transaction. Doing it as "upload, then insert" from
 *     the client is what used to charge for a note that never arrived.
 *
 * A failed RPC removes the object again, so the bucket does not accumulate
 * orphans nobody can see.
 */
export async function sendVoiceNote(input: {
  conversationId: string;
  recording: VoiceRecording;
  caption?: string | null;
  replyToId?: string | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const path = `${input.conversationId}/${randomId()}.${input.recording.extension}`;

  const body = input.recording.blob ?? (await uriToBlob(input.recording.uri));

  const { error: uploadError } = await supabase.storage
    .from("voice-messages")
    .upload(path, body, { contentType: input.recording.mimeType, upsert: false });

  if (uploadError) {
    return { ok: false, error: describeVoiceFailure(uploadError.message) };
  }

  const { error: sendError } = await supabase.rpc("send_voice_note", {
    target_conversation_id: input.conversationId,
    storage_path: path,
    duration_ms: Math.round(input.recording.durationMs),
    waveform: input.recording.waveform,
    mime_type: input.recording.mimeType,
    caption: input.caption?.trim() ? input.caption.trim() : null,
    reply_to: input.replyToId ?? null,
    /* Accepted and ignored at the database: every voice note is view-once.
       A recording of the sender's real voice is the one thing in this app that
       cannot be taken back once stored, so it is never stored past first play. */
    view_once: true,
  });

  if (sendError) {
    await supabase.storage.from("voice-messages").remove([path]);
    return { ok: false, error: describeVoiceFailure(sendError.message) };
  }

  return { ok: true };
}

/** Turns the storage layer's failures into sentences. Ported from the chat page. */
export function describeVoiceFailure(message: string): string {
  const text = message.toLowerCase();
  if (text.includes("send_voice_note") || text.includes("pgrst202") || text.includes("could not find the function")) {
    return "Voice notes aren't available on this server yet. Please update the app.";
  }
  if (text.includes("row-level security") || text.includes("permission")) {
    return "You don't have permission to send a voice note in this chat.";
  }
  if (text.includes("maximum allowed size") || text.includes("too large")) {
    return "That voice note is too long to upload.";
  }
  if (text.includes("insufficient")) {
    return "You don't have enough coins to send a voice note.";
  }
  return "Couldn't send that voice note. Please try again.";
}

/** A UUID v4 without pulling a dependency: crypto.randomUUID when available. */
export function randomId(): string {
  const globalCrypto = globalThis.crypto as { randomUUID?: () => string } | undefined;
  if (globalCrypto?.randomUUID) return globalCrypto.randomUUID();

  /* RFC 4122 shape, and only used as a storage object name — uniqueness within
     one bucket path is the entire requirement. */
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const random = (Math.random() * 16) | 0;
    const value = char === "x" ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

/** Reads a local `file://` URI into a Blob for upload. */
async function uriToBlob(uri: string): Promise<Blob> {
  const response = await fetch(uri);
  return response.blob();
}

/* ---------------------------------------------------------------------------
 * Read receipts, delivery ticks, unlocks
 * ------------------------------------------------------------------------ */

/** Stamps this user's read column on the conversation row. */
export async function stampConversationRead(
  conversationId: string,
  userId: string,
  conversation: ConversationRow | null
): Promise<void> {
  const readColumn = conversation
    ? readColumnFor(conversation, userId)
    : "user_a_last_read_at";

  const { error } = await supabase
    .from("conversations")
    .update({ [readColumn]: new Date().toISOString() })
    .eq("id", conversationId);

  if (error) console.warn("[dms] conversation stamp failed:", error.message);
}

/** Marks incoming messages delivered. */
export async function markDelivered(messageIds: string[]): Promise<void> {
  if (messageIds.length === 0) return;
  const now = new Date().toISOString();
  const { error } = await supabase.from("direct_messages").update({ delivered_at: now }).in("id", messageIds);
  if (error) console.warn("[dms] delivery stamp failed:", error.message);
}

/** Marks incoming messages read, and stamps the conversation. */
export async function markRead(messageIds: string[]): Promise<void> {
  if (messageIds.length === 0) return;
  const now = new Date().toISOString();
  const { error } = await supabase
    .from("direct_messages")
    .update({ read_at: now, delivered_at: now })
    .in("id", messageIds);
  if (error) console.warn("[dms] read stamp failed:", error.message);
}

/** Has this user bought this conversation? */
export async function isChatUnlocked(conversationId: string, userId: string): Promise<boolean> {
  const { data } = await supabase
    .from("chat_unlocks")
    .select("id")
    .eq("user_id", userId)
    .eq("conversation_id", conversationId)
    .maybeSingle();

  return Boolean(data);
}

/** Are these two accounts friends? Friends chat without paying the unlock. */
export async function areFriends(userId: string, otherId: string): Promise<boolean> {
  const { data } = await supabase
    .from("friends")
    .select("id")
    .eq("user_id", userId)
    .eq("friend_id", otherId)
    .maybeSingle();

  return Boolean(data);
}

/** Spends the 40 coins that open a conversation. Returns the new balance. */
export async function unlockChat(conversationId: string): Promise<{ balance: number }> {
  const { data, error } = await supabase.rpc("unlock_chat_with_coins", {
    target_conversation_id: conversationId,
  });
  if (error) throw error;
  return { balance: Number(data ?? 0) };
}

/** Clears expired pins on chat open — the lazy sweep the schema documents. */
export async function sweepExpiredPins(conversationId: string): Promise<void> {
  await supabase.rpc("sweep_expired_pins", { target_conversation_id: conversationId });
}

/* ---------------------------------------------------------------------------
 * View-once media
 * ------------------------------------------------------------------------ */

/**
 * Claims a view-once photo.
 *
 * Through `/api/photos/view` under the caller's JWT, not a storage URL: the
 * route records the view, deletes the object and nulls `image_path` in the same
 * breath. A direct download would leave the photo retrievable forever, which is
 * the opposite of what "view once" promised the person who sent it.
 */
export async function claimPhoto(
  messageId: string,
  accessToken: string
): Promise<{ uri: string } | { error: string }> {
  return claimViewOnce("/api/photos/view", { messageId }, accessToken, "photo");
}

/** Claims a voice note's audio bytes. Same route rules as the photo. */
/** Claims a voice note's audio bytes. Same route rules as the photo. */
export async function claimAudio(
  message: DirectMessage,
  accessToken: string
): Promise<{ uri: string } | { error: string }> {
  if (!message.audio_path && !message.media_url) {
    return { error: "That voice note is no longer available." };
  }
  return claimViewOnce("/api/audio/view", { messageId: message.id }, accessToken, "voice note");
}

/**
 * The one claim request, shared by both view-once kinds.
 *
 * The route answers with the bytes on success and with `{ error }` JSON on
 * every refusal — expired, already viewed, not a participant, missing — and the
 * distinction matters to the user: "you already viewed this" is not a network
 * failure. Both shapes are parsed here so the screens only ever see one.
 */
async function claimViewOnce(
  path: string,
  body: Record<string, unknown>,
  accessToken: string,
  label: string
): Promise<{ uri: string } | { error: string }> {
  try {
    const res = await fetch(`${apiBase()}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      return { error: json.error || `That ${label} is no longer available.` };
    }

    const contentType = res.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      /* A deployment that answers with a short-lived URL instead of streaming.
         Either way there is something to render or play. */
      const json = (await res.json()) as { url?: string; error?: string };
      if (json.error) return { error: json.error };
      if (json.url) return { uri: json.url };
      return { error: `That ${label} is no longer available.` };
    }

    const blob = await res.blob();
    return { uri: await blobToDataUri(blob, contentType || undefined) };
  } catch {
    return { error: "Couldn't open that. Check your connection." };
  }
}

/** A `data:` URI for a blob, which expo-av can play without touching disk. */
export async function blobToDataUri(blob: Blob, mimeType?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(String(reader.result ?? `data:${mimeType};base64,`));
    reader.readAsDataURL(blob);
  });
}
