"use client";

import { useEffect, useState } from "react";
import { Copy, Share2 } from "lucide-react";
import Modal from "@/components/Modal";
import SocialIcon, { SOCIAL_LABELS } from "@/components/SocialIcon";
import { shareExcerpt, shareTargetUrl, type FeedPost, type ShareTarget } from "@/lib/feed";
import { vibrate, HAPTIC } from "@/lib/haptics";

/**
 * Sharing one whisper outward.
 *
 * The link is the post's own permalink — `/public-feed?post=<id>` — not the
 * author's Whisper link. Both were candidates and the permalink wins because a
 * share is a pointer at *this* whisper: someone who follows it should land on the
 * thing they were shown, with its replies and its author's link already on it. A
 * share that opened a blank "send an anonymous message" form instead makes the
 * quote unverifiable, which is the fastest way for a shared post to read as
 * invented.
 *
 * Native share is offered first where it exists, because on a phone it is the
 * only option that reaches WhatsApp *and* the fifty other places people
 * actually send things. The three named targets are underneath for the desktop
 * case and for the phones whose share sheet people don't trust.
 */

type FeedShareSheetProps = {
  post: FeedPost | null;
  onClose: () => void;
  onCopy: (post: FeedPost) => void;
};

/**
 * The marks come from `SocialIcon`, not from lucide — lucide dropped every brand
 * glyph, and the approximations people reach for instead ("a speech bubble means
 * WhatsApp") are the exact tell this app already decided not to ship. `ShareTarget`
 * is a subset of `SocialPlatform`, so the same authoritative geometry and labels
 * serve both this sheet and the follow prompt.
 */
const TARGETS: ShareTarget[] = ["whatsapp", "x", "facebook"];

export function feedPostUrl(postId: string) {
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  return `${origin}/public-feed?post=${postId}`;
}

export default function FeedShareSheet({ post, onClose, onCopy }: FeedShareSheetProps) {
  /* Resolved in an effect rather than inline: `navigator.share` does not exist
     during the server render, and reading it in the render body is a hydration
     mismatch that swaps a button in on the second frame. */
  const [canNativeShare, setCanNativeShare] = useState(false);
  useEffect(() => {
    setCanNativeShare(typeof navigator !== "undefined" && typeof navigator.share === "function");
  }, []);

  const url = post ? feedPostUrl(post.id) : "";
  const text = post ? `"${shareExcerpt(post.body)}" — on Whisper 👻` : "";

  async function nativeShare() {
    if (!post) return;
    vibrate(HAPTIC.tap);
    try {
      await navigator.share({ title: "Whisper", text, url });
      onClose();
    } catch {
      /* Cancelled, or the payload was refused. Either way the sheet stays open
         so the named targets are still there — closing it would look like the
         share had succeeded. */
    }
  }

  return (
    <Modal
      open={Boolean(post)}
      onClose={onClose}
      variant="sheet"
      title="Share this whisper"
      className="feed-sheet"
    >
      <div className="feed-sheet-body">
        {post && <p className="feed-sheet-quote">{shareExcerpt(post.body, 220)}</p>}

        {canNativeShare && (
          <button type="button" onClick={() => void nativeShare()} className="feed-sheet-item is-primary">
            <Share2 size={17} aria-hidden />
            Share via…
          </button>
        )}

        <button
          type="button"
          onClick={() => {
            if (!post) return;
            vibrate(HAPTIC.tap);
            onCopy(post);
            onClose();
          }}
          className="feed-sheet-item"
        >
          <Copy size={17} aria-hidden />
          Copy link
        </button>

        <div className="feed-share-targets">
          {TARGETS.map((target) => (
            <a
              key={target}
              href={post ? shareTargetUrl(target, text, url) : "#"}
              target="_blank"
              /* `noopener` is the security half and `noreferrer` the privacy
                 half — without the latter the destination learns which Whisper
                 page the share came from. */
              rel="noopener noreferrer"
              onClick={() => {
                vibrate(HAPTIC.tap);
                onClose();
              }}
              className={`feed-share-target is-${target}`}
            >
              <SocialIcon platform={target} size={18} />
              {SOCIAL_LABELS[target]}
            </a>
          ))}
        </div>
      </div>
    </Modal>
  );
}
