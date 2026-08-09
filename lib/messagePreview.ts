/**
 * One place that decides how a message is described when it isn't being shown
 * in full — reply quotes, the pinned bar, the inbox row, the pin-duration sheet.
 *
 * Every one of those used to inline its own `content || "📷 Photo"`, which was
 * wrong for voice notes in the same way each time: a voice note is always sent
 * `is_view_once`, and it has no `content`, so every caller fell through to the
 * photo label. Replying to a voice note announced "📷 Photo".
 *
 * The discriminator is the audio columns, not `is_view_once`. `audio_path` is
 * nulled server-side the moment a view-once note is played, so `audio_viewed_at`
 * has to count too — otherwise a played note reverts to reading as a photo.
 */

export type PreviewableMessage = {
  content?: string | null;
  image_path?: string | null;
  audio_path?: string | null;
  audio_viewed_at?: string | null;
  is_view_once?: boolean | null;
};

export const VOICE_NOTE_LABEL = "🎙️ Voice note";
export const PHOTO_LABEL = "📷 Photo";

export function isVoiceNote(message: PreviewableMessage | null | undefined) {
  if (!message) return false;
  return Boolean(message.audio_path) || Boolean(message.audio_viewed_at);
}

export function isPhotoMessage(message: PreviewableMessage | null | undefined) {
  if (!message) return false;
  return Boolean(message.image_path) && !isVoiceNote(message);
}

/**
 * The caption wins when there is one — a voice note sent with text reads better
 * as its text, and that matches what WhatsApp quotes. `mediaOnly` skips the
 * caption for callers that want the media kind regardless.
 */
export function messagePreviewText(
  message: PreviewableMessage | null | undefined,
  options: { mediaOnly?: boolean; fallback?: string } = {}
) {
  if (!message) return options.fallback ?? "";

  const caption = (message.content || "").trim();
  if (caption && !options.mediaOnly) return caption;

  if (isVoiceNote(message)) return VOICE_NOTE_LABEL;
  if (message.image_path) return PHOTO_LABEL;

  return caption || options.fallback || "Message";
}
