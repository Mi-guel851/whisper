/**
 * Row shapes, mirroring the schema the web app already reads.
 *
 * These are deliberately the same field names as the database columns — no
 * camelCase mapping — because every query in this app is a copy of the query
 * the web client makes, and a translation layer is one more place for the two
 * clients to disagree about what a column means.
 */

/** One page of `public_feed_page` / a row of `public_feed_posts`. */
export type FeedPost = {
  id: string;
  author_id: string;
  body: string;
  whisper_link: string;
  created_at: string;
  expires_at: string;
  parent_post_id?: string | null;
  view_count?: number | null;

  /** Present in the premium migration; absent on an older database. */
  topic?: string | null;
  has_image?: boolean | null;
  image_preview?: string | null;
  poll_options?: string[] | null;
  poll_counts?: number[] | null;

  like_count?: number | null;
  reply_count?: number | null;
  viewer_liked?: boolean | null;
  viewer_image_viewed?: boolean | null;
  viewer_vote?: number | null;
  rank_score?: number | null;

  /** `'user'` or `'whisper_creator'`. Written by the database only. */
  author_role?: string | null;

  /** Client-only: a row the composer put on screen before the server confirmed. */
  send_state?: "sending" | "failed";
};

export type FeedPostNode = FeedPost & { children: FeedPostNode[] };

/** A received anonymous whisper — a row of `public.messages`. */
export type Whisper = {
  id: string;
  message: string | null;
  image_url: string | null;
  created_at: string;
  is_read: boolean;
};

/** The paid sender hint, readable only after `anonymous_sender_reveals` has a row. */
export type WhisperHint = {
  message_id: string;
  sender_country: string | null;
  sender_state: string | null;
  sender_city: string | null;
  sender_device: string | null;
  sent_at: string | null;
};

/** A row of `inbox_conversations()` (or the plain `conversations` fallback). */
export type ConversationRow = {
  id: string;
  user_a: string;
  user_b: string;
  user_a_last_read_at: string | null;
  user_b_last_read_at: string | null;
  last_message_at: string | null;
  last_message_sender_id: string | null;
  latest_message_at?: string | null;
  latest_message_sender_id?: string | null;
};

/** A direct message. `inbox_message_previews` returns the same shape. */
export type DirectMessage = {
  id: string;
  conversation_id: string;
  sender_id: string;
  content: string | null;
  created_at: string;
  is_view_once: boolean | null;
  image_path: string | null;
  image_viewed_at: string | null;
  audio_path: string | null;
  audio_viewed_at: string | null;
  audio_duration_ms: number | null;
  audio_waveform: number[] | null;
  audio_mime: string | null;
  media_url: string | null;
  media_kind: string | null;
  media_width: number | null;
  media_height: number | null;
  delivered_at: string | null;
  read_at: string | null;
  reply_to_id: string | null;
};

/** A row of `public.notifications` — the durable alert history. */
export type NotificationRow = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  metadata: { route?: string; conversation_id?: string; conversationId?: string; post_id?: string } | null;
  is_read: boolean;
  created_at: string;
};

/** `profiles` — the columns this app actually reads. */
export type Profile = {
  id: string;
  display_name: string | null;
  username: string | null;
  bio: string | null;
  avatar_url: string | null;
  anon_name: string | null;
  push_notifications?: boolean | null;
  notify_feed_posts?: boolean | null;
  notify_replies?: boolean | null;
  notify_friend_requests?: boolean | null;
  notify_coin_transfers?: boolean | null;
  notify_calls?: boolean | null;
  profile_completed?: boolean | null;
  created_at?: string | null;
};

/** The wallet row (`public.coins`). */
export type Wallet = {
  balance: number;
  wallet_address: string | null;
};

/** A row of `public.coin_transactions`. */
export type CoinTransaction = {
  id: string;
  amount: number;
  description: string | null;
  transaction_type: string;
  created_at: string;
  reference: string | null;
};

/** One tick in a friend's presence — used only to light the inbox dot. */
export type PresenceUser = { id: string; online_at?: string };

/** A local recording, before it is uploaded. */
export type VoiceRecording = {
  uri: string;
  /** Wall-clock length of the capture, ms. */
  durationMs: number;
  /** Amplitude samples, 0–100, ~10/sec. Stored so the receiver sees this waveform. */
  waveform: number[];
  mimeType: string;
  extension: string;
  blob?: Blob;
};
