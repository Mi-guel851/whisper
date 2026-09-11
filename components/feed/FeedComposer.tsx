"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import Link from "next/link";
import { Image as ImageIcon, ListOrdered, Loader2, Plus, Send, Sparkles, X } from "lucide-react";
import GlassPanel from "@/components/GlassPanel";
import WhisperCoinIcon from "@/components/WhisperCoinIcon";
import { useToast } from "@/components/ToastProvider";
import { FEED_TOPICS, stripLinks, type FeedTopic } from "@/lib/feed";
import { generateFeedSuggestion, type FeedSuggestion } from "@/lib/feedSuggestions";
import { ImagePrepError, prepareFeedImage, type PreparedFeedImage } from "@/lib/imagePreview";
import { PROSE_INPUT_PROPS } from "@/lib/textEntry";
import { vibrate, HAPTIC } from "@/lib/haptics";
import FeedAvatar from "./FeedAvatar";

/**
 * The composer.
 *
 * Lifted out of the page unchanged in behaviour and then given the three things
 * the feed was missing: a topic, a photo, and a poll.
 *
 * WHY THIS OWNS ITS OWN STATE
 *
 * Every keystroke here used to re-render the entire page, and therefore every
 * post in the timeline — a textarea and a forty-row list sharing one state owner
 * is the classic version of that mistake. `onSubmit` returns a promise resolving
 * to whether the post landed, so the composer can clear itself and the page never
 * needs to hold the draft. The one thing the page can still do is nudge: bump
 * `prefillNonce` and the draft is replaced and focused, which is how "Answer
 * anonymously" and the empty state's "Write a post" both work.
 *
 * PHOTO AND POLL ARE MUTUALLY EXCLUSIVE
 *
 * Enforced here and again in the API route. A post is one idea; a picture with a
 * poll under it is two, and the storage/refund path in the route would have to
 * unwind both if either failed.
 */

const MAX_BODY = 500;
const MAX_POLL_OPTIONS = 4;
const MAX_POLL_OPTION_CHARS = 60;

export type ComposerDraft = {
  body: string;
  topic: FeedTopic | null;
  /** Trimmed, non-empty options, or null when this isn't a poll. */
  poll: string[] | null;
  image: PreparedFeedImage | null;
};

type FeedComposerProps = {
  /**
   * The poster, for their own anonymous avatar beside the field. Empty until the
   * session resolves, which `FeedAvatar` already renders as its neutral glyph —
   * so there is nothing to gate here.
   */
  authorId: string;
  ownLink: string;
  postCost: number;
  /** Bumped by the page to replace the draft and focus the field. */
  prefillNonce: number;
  prefillBody: string;
  prefillTopic: FeedTopic | null;
  /**
   * Open with two blank poll options already showing. The drawer's "Start a poll"
   * row is the only caller — it is a promise that tapping it produces a poll, and
   * landing on an empty textarea with the poll tool still un-toggled would break
   * that promise.
   */
  prefillPoll?: boolean;
  /**
   * "bare" drops the glass panel, for when the composer is already inside one.
   * Stacking two translucent surfaces is the one thing that reliably ruins them:
   * the blur compounds, the borders double, and text over the pair loses contrast.
   */
  variant?: "panel" | "bare";
  /**
   * Receives the main text field's element, so an owner surfacing this in a
   * dialog can aim the dialog's open-time focus at it (see Modal's
   * `initialFocus`) — a composer that opens anywhere other than its field is
   * a second tap waiting to happen. Optional because the composer also keeps
   * its own ref for the prefill focus.
   */
  fieldRef?: RefObject<HTMLTextAreaElement | null>;
  onSubmit: (draft: ComposerDraft) => Promise<boolean>;
};

export default function FeedComposer({
  authorId,
  ownLink,
  postCost,
  prefillNonce,
  prefillBody,
  prefillTopic,
  prefillPoll = false,
  variant = "panel",
  fieldRef,
  onSubmit,
}: FeedComposerProps) {
  const { showToast } = useToast();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  /* One element, two owners: this component focuses the field when a prefill
     lands, and the sheet points Modal's open-time focus at it. */
  const setFieldRef = useCallback(
    (element: HTMLTextAreaElement | null) => {
      textareaRef.current = element;
      if (fieldRef) fieldRef.current = element;
    },
    [fieldRef],
  );

  const [body, setBody] = useState("");
  const [topic, setTopic] = useState<FeedTopic | null>(null);
  const [generatedSuggestion, setGeneratedSuggestion] = useState<FeedSuggestion | null>(null);
  const [submitting, setSubmitting] = useState(false);
  /* Keep generated ideas fresh for this composer session. Once all ideas in a
     selected topic have been used, the helper resets that topic's pool. */
  const generatedSuggestionIds = useRef<Set<string>>(new Set());

  const [pollOptions, setPollOptions] = useState<string[] | null>(null);
  const [image, setImage] = useState<PreparedFeedImage | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [preparingImage, setPreparingImage] = useState(false);

  const cleanBody = stripLinks(body);

  /* The page asked for the field. Replacing the draft is intentional: the only
     callers are controls that offer a starting point, and merging into whatever
     was already typed would produce nonsense. */
  useEffect(() => {
    if (prefillNonce === 0) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setBody(prefillBody);
      setTopic(prefillTopic);
      setGeneratedSuggestion(null);
      if (prefillPoll) {
        /* A photo cannot ride with a poll, so the poll request wins and the photo
           is dropped — the caller asked for a poll explicitly. */
        setImage(null);
        setImageUrl(null);
        setPollOptions((current) => current ?? ["", ""]);
      }
      const field = textareaRef.current;
      field?.focus();
      field?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    return () => {
      cancelled = true;
    };
    // Only the nonce should trigger this; the body/topic are read at that moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefillNonce]);

  /* An object URL outlives the render that made it, so it has to be revoked by
     hand or every re-pick leaks a decoded bitmap. */
  useEffect(() => {
    if (!imageUrl) return;
    return () => URL.revokeObjectURL(imageUrl);
  }, [imageUrl]);

  function clearImage() {
    setImage(null);
    setImageUrl(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  const writeWithAi = useCallback(() => {
    vibrate(HAPTIC.select);
    const suggestion = generateFeedSuggestion(topic, generatedSuggestionIds.current);
    generatedSuggestionIds.current.add(suggestion.id);
    setGeneratedSuggestion(suggestion);
    setBody(suggestion.text);
    /* Keep the interaction feeling like writing into the field, not opening a
       second picker. The next tap generates another idea from the same 128-entry
       topic-balanced bank without ever rendering that bank as a list. */
    queueMicrotask(() => {
      textareaRef.current?.focus();
      textareaRef.current?.select();
    });
  }, [topic]);

  async function pickImage(file: File | undefined) {
    if (!file) return;
    setPreparingImage(true);
    try {
      const prepared = await prepareFeedImage(file);
      setImage(prepared);
      setImageUrl(URL.createObjectURL(prepared.upload));
      /* A poll and a photo can't ride together, and silently dropping one would
         be worse than saying so. */
      if (pollOptions) {
        setPollOptions(null);
        showToast("Removed the poll — a whisper carries a photo or a poll, not both.");
      }
    } catch (error) {
      const message =
        error instanceof ImagePrepError ? error.message : "Couldn't read that image.";
      showToast(message);
      clearImage();
    } finally {
      setPreparingImage(false);
    }
  }

  function togglePoll() {
    vibrate(HAPTIC.tap);
    if (pollOptions) {
      setPollOptions(null);
      return;
    }
    if (image) {
      showToast("Remove the photo first — a whisper carries a photo or a poll, not both.");
      return;
    }
    setPollOptions(["", ""]);
  }

  function setPollOption(index: number, value: string) {
    setPollOptions((current) => {
      if (!current) return current;
      const next = [...current];
      next[index] = value.slice(0, MAX_POLL_OPTION_CHARS);
      return next;
    });
  }

  const filledPollOptions = (pollOptions ?? []).map((option) => option.trim()).filter(Boolean);
  const pollReady = !pollOptions || filledPollOptions.length >= 2;
  const canSubmit =
    Boolean(cleanBody) && Boolean(ownLink) && pollReady && !submitting && !preparingImage;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit) {
      if (pollOptions && !pollReady) showToast("A poll needs at least two options.");
      return;
    }

    setSubmitting(true);
    try {
      const posted = await onSubmit({
        body: cleanBody,
        topic,
        poll: pollOptions ? filledPollOptions.slice(0, MAX_POLL_OPTIONS) : null,
        image,
      });

      if (posted) {
        setBody("");
        setTopic(null);
        setGeneratedSuggestion(null);
        setPollOptions(null);
        clearImage();
      }
    } finally {
      setSubmitting(false);
    }
  }

  const form = (
    <form onSubmit={submit}>
        {/* The avatar sits beside the field rather than above it, which is what
            makes the composer read as "you, about to say something" instead of a
            bare textarea — and it is the same anonymous identity the post will
            carry, resolved from the same hook the cards use. */}
        <div className="flex gap-3">
          <div className="shrink-0 pt-0.5">
            <FeedAvatar authorId={authorId} size={40} />
          </div>

          <textarea
            ref={setFieldRef}
            {...PROSE_INPUT_PROPS}
            value={body}
            onChange={(event) => {
              setBody(event.target.value);
              setGeneratedSuggestion(null);
            }}
            maxLength={MAX_BODY}
            rows={3}
            placeholder="Share a thought with the Whisper community..."
            className="min-w-0 flex-1 resize-none bg-transparent pt-1.5 text-sm outline-none"
            style={{ color: "var(--theme-text)" }}
          />
        </div>

        {/* Optional, and shown as such. A required topic on a confession app is a
            question people answer wrongly to get past it. */}
        <div className="feed-composer-topics" role="group" aria-label="Topic">
          {FEED_TOPICS.map((entry) => (
            <button
              key={entry.key}
              type="button"
              aria-pressed={topic === entry.key}
              onClick={() => {
                vibrate(HAPTIC.tap);
                setTopic((current) => (current === entry.key ? null : entry.key));
              }}
              className={`feed-composer-topic ${topic === entry.key ? "is-active" : ""}`}
            >
              <span aria-hidden>{entry.emoji}</span>
              {entry.label}
            </button>
          ))}
        </div>

        {imageUrl && (
          <div className="feed-composer-attachment">
            {/* Your own photo, unblurred — you are choosing what to send, and the
                blur is for the people who receive it. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={imageUrl} alt="Attached photo" className="feed-composer-thumb" />
            <div className="feed-composer-attachment-copy">
              <p className="feed-composer-attachment-title">Photo attached</p>
              <p className="feed-composer-attachment-note">
                Everyone sees a blurred preview. Each person can open it once.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                vibrate(HAPTIC.tap);
                clearImage();
              }}
              aria-label="Remove photo"
              className="feed-composer-attachment-remove"
            >
              <X size={15} />
            </button>
          </div>
        )}

        {pollOptions && (
          <div className="feed-composer-poll">
            {pollOptions.map((option, index) => (
              <div key={index} className="feed-composer-poll-row">
                <input
                  value={option}
                  onChange={(event) => setPollOption(index, event.target.value)}
                  maxLength={MAX_POLL_OPTION_CHARS}
                  placeholder={`Option ${index + 1}`}
                  aria-label={`Poll option ${index + 1}`}
                  className="feed-composer-poll-input"
                />
                {pollOptions.length > 2 && (
                  <button
                    type="button"
                    onClick={() =>
                      setPollOptions((current) =>
                        current ? current.filter((_, i) => i !== index) : current
                      )
                    }
                    aria-label={`Remove option ${index + 1}`}
                    className="feed-composer-poll-remove"
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
            ))}

            {pollOptions.length < MAX_POLL_OPTIONS && (
              <button
                type="button"
                onClick={() => setPollOptions((current) => (current ? [...current, ""] : current))}
                className="feed-composer-poll-add"
              >
                <Plus size={14} />
                Add option
              </button>
            )}
          </div>
        )}

        <div className="mt-3">
          <button
            type="button"
            onClick={writeWithAi}
            className="glass-control flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl px-3 py-2.5 text-xs font-bold transition"
            style={{ color: "var(--theme-accent-pink)" }}
            aria-label="Generate a new public feed post with AI"
          >
            <Sparkles size={14} />
            {generatedSuggestion ? "Generate another AI idea" : "AI Write"}
          </button>
          {generatedSuggestion && (
            <p
              className="mt-2 text-center text-[0.6875rem] leading-4"
              style={{ color: "var(--theme-text-muted)" }}
              role="status"
            >
              Fresh {FEED_TOPICS.find((entry) => entry.key === generatedSuggestion.topic)?.label.toLowerCase()} idea generated. Tap again for another.
            </p>
          )}
        </div>

        <div
          className="mt-3 flex items-center justify-between gap-3 border-t pt-3"
          style={{ borderColor: "var(--theme-border)" }}
        >
          <div className="feed-composer-tools">
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="sr-only"
              onChange={(event) => void pickImage(event.target.files?.[0])}
            />
            <button
              type="button"
              onClick={() => {
                vibrate(HAPTIC.tap);
                fileRef.current?.click();
              }}
              disabled={preparingImage}
              aria-label="Attach a photo"
              className={`feed-composer-tool ${image ? "is-active" : ""}`}
            >
              {preparingImage ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <ImageIcon size={16} />
              )}
            </button>
            <button
              type="button"
              onClick={togglePoll}
              aria-label="Add a poll"
              aria-pressed={Boolean(pollOptions)}
              className={`feed-composer-tool ${pollOptions ? "is-active" : ""}`}
            >
              <ListOrdered size={16} />
            </button>
            <span className="feed-composer-count tabular-nums">
              {MAX_BODY - body.length}
            </span>
          </div>

          <button
            type="submit"
            disabled={!canSubmit}
            className="premium-button premium-button-primary flex shrink-0 items-center gap-2 rounded-2xl px-4 py-2.5 text-sm font-black disabled:opacity-50"
          >
            {submitting ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
            {/* The price is on the control that spends it. A cost that only
                appears in the toast afterwards reads as a charge you weren't
                told about, however small it is. */}
            {submitting ? "Posting" : `Post · ${postCost}`}
            {!submitting && <WhisperCoinIcon size={14} />}
          </button>
        </div>

        <p className="feed-composer-foot">
          Your Whisper link is attached automatically.{" "}
          {ownLink && (
            <Link href={ownLink} className="theme-accent-text">
              whisper.app{ownLink}
            </Link>
          )}
        </p>
      </form>
  );

  if (variant === "bare") return form;

  return (
    <GlassPanel strong className="mb-6 rounded-3xl p-5">
      {form}
    </GlassPanel>
  );
}
