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
 *
 * A view-once *photo* has the same shape of problem and used to lose to it.
 * `app/api/photos/view/route.ts` nulls `image_path` when the photo is opened, so
 * a spent photo arrives here with no content, no image and no audio — every
 * discriminator empty — and fell through to the generic fallback. In the inbox
 * that read as a row with nothing in it, which is indistinguishable from a bug:
 * the message is gone *and* the app appears to have lost track of it.
 * `image_viewed_at` is the column that survives, so it is what the "already seen"
 * label keys off.
 */

export type PreviewableMessage = {
  content?: string | null;
  image_path?: string | null;
  image_viewed_at?: string | null;
  audio_path?: string | null;
  audio_viewed_at?: string | null;
  is_view_once?: boolean | null;
};

export const VOICE_NOTE_LABEL = "🎙️ Voice note";
export const PHOTO_LABEL = "📷 Photo";
/** Past tense on purpose: it states what happened, not what is available. */
export const PHOTO_VIEWED_LABEL = "📷 Photo viewed";

export function isVoiceNote(message: PreviewableMessage | null | undefined) {
  if (!message) return false;
  return Boolean(message.audio_path) || Boolean(message.audio_viewed_at);
}

export function isPhotoMessage(message: PreviewableMessage | null | undefined) {
  if (!message) return false;
  return (
    (Boolean(message.image_path) || Boolean(message.image_viewed_at)) &&
    !isVoiceNote(message)
  );
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
  /* `image_path` first: while the file is still there the photo can still be
     opened, so it is described as a photo. Only once it has been spent — the file
     nulled, the timestamp left behind — does it become the past-tense label. */
  if (message.image_path) return PHOTO_LABEL;
  if (message.image_viewed_at) return PHOTO_VIEWED_LABEL;

  return caption || options.fallback || "Message";
}
