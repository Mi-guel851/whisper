"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import Modal from "@/components/Modal";
import { PROSE_INPUT_PROPS } from "@/lib/textEntry";
import type { ReportReason } from "@/lib/feedApi";
import type { FeedPost } from "@/lib/feed";

/**
 * Reporting a whisper.
 *
 * The reasons mirror `public_feed_reports_reason_check` exactly. They are a
 * closed set on purpose: free-text-only reports are unsortable, and a moderation
 * queue you cannot sort is a moderation queue nobody reads. Details stay
 * optional on top of that, because the one thing a fixed list can't capture is
 * context.
 *
 * The self-harm branch is the one place this stops being a form. Someone
 * reporting that has usually just read something upsetting, and answering with
 * nothing but a confirmation toast is the wrong response — so the option carries
 * a line about what actually happens next.
 */

const REASONS: Array<{ key: ReportReason; label: string; hint: string }> = [
  { key: "spam", label: "Spam or scam", hint: "Repeated posts, promotion, or a link farm." },
  { key: "harassment", label: "Harassment or hate", hint: "Targeting a person or a group." },
  { key: "sexual", label: "Sexual content", hint: "Explicit or unwanted sexual material." },
  { key: "violence", label: "Violence or threats", hint: "Threatening harm to anyone." },
  {
    key: "self_harm",
    label: "Self-harm or suicide",
    hint: "We review these first. If someone is in danger, please also contact local emergency services.",
  },
  { key: "other", label: "Something else", hint: "Tell us below." },
];

const MAX_DETAILS = 400;

type FeedReportSheetProps = {
  post: FeedPost | null;
  submitting: boolean;
  onClose: () => void;
  onSubmit: (post: FeedPost, reason: ReportReason, details: string) => void;
};

export default function FeedReportSheet({
  post,
  submitting,
  onClose,
  onSubmit,
}: FeedReportSheetProps) {
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [details, setDetails] = useState("");

  /* Reset when the sheet is pointed at a different post, so a reason picked for
     one whisper can't be submitted against another. */
  useEffect(() => {
    if (!post) return;
    setReason(null);
    setDetails("");
  }, [post?.id, post]);

  const selected = REASONS.find((entry) => entry.key === reason);

  return (
    <Modal
      open={Boolean(post)}
      onClose={onClose}
      variant="sheet"
      title="Report this whisper"
      description="Reports are anonymous to the author. They never see who reported them."
      className="feed-sheet"
    >
      <div className="feed-sheet-body">
        <div role="radiogroup" aria-label="Reason" className="feed-report-reasons">
          {REASONS.map((entry) => (
            <button
              key={entry.key}
              type="button"
              role="radio"
              aria-checked={reason === entry.key}
              onClick={() => setReason(entry.key)}
              className={`feed-report-reason ${reason === entry.key ? "is-active" : ""}`}
            >
              <span className="feed-report-reason-label">{entry.label}</span>
              <span className="feed-report-reason-hint">{entry.hint}</span>
            </button>
          ))}
        </div>

        <label className="feed-report-details">
          <span className="feed-report-details-label">
            {selected?.key === "other" ? "What happened?" : "Anything else? (optional)"}
          </span>
          <textarea
            {...PROSE_INPUT_PROPS}
            value={details}
            onChange={(event) => setDetails(event.target.value)}
            maxLength={MAX_DETAILS}
            rows={3}
            className="feed-report-textarea"
            placeholder="Add context for the moderators"
          />
        </label>

        <button
          type="button"
          disabled={!reason || submitting || !post}
          onClick={() => {
            if (!post || !reason) return;
            onSubmit(post, reason, details);
          }}
          className="feed-report-submit"
        >
          {submitting && <Loader2 size={15} className="animate-spin" />}
          {submitting ? "Sending" : "Send report"}
        </button>
      </div>
    </Modal>
  );
}
