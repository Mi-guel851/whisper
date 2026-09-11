"use client";

import { useRef } from "react";
import Modal from "@/components/Modal";
import FeedComposer, { type ComposerDraft } from "./FeedComposer";

/**
 * The composer, in a sheet.
 *
 * This is a wrapper and deliberately nothing more. `FeedComposer` already owns the
 * draft, the topic, the photo pipeline, the poll builder, the coin cost and the
 * submit lifecycle; a second composer built for the sheet would be the same file
 * twice, drifting apart at the first change to either. So the sheet supplies only
 * what a sheet supplies — the surface, the scrim, the drag-down dismiss, the scroll
 * lock and the focus trap, all of which `Modal` already does.
 *
 * The one thing it supplies beyond the surface is the focus hand-off. Left to
 * itself, `Modal` lands its open-time focus on the first focusable element in
 * DOM order — the close button, which precedes the content — so a composer
 * opened from the FAB, the drawer or the Daily Question would come up with
 * focus on its close control: the keyboard a prefill briefly raised is
 * dismissed again the frame after, and typing means tapping the field first.
 * The field is pointed out to the Modal instead, so every open goes straight
 * into it, caret waiting and keyboard up.
 *
 * It closes itself on a successful post, because `onSubmit` resolves to whether the
 * post landed: a sheet left open over a feed that now contains the whisper reads as
 * a failure. A rejected post keeps the sheet up with the draft intact, which is the
 * only behaviour that does not lose what somebody typed.
 *
 * PRESENTATION: FULL SCREEN
 *
 * This renders as a full-screen compose surface — Instagram/Twitter style —
 * sliding up from the bottom to cover 100% of the viewport height on mobile,
 * and as a centered full-height column over a dark backdrop on desktop. Only
 * the presentation changed: the draft, the topic, the photo pipeline, the
 * poll builder, the coin cost, the submit lifecycle and every validation rule
 * are untouched inside `FeedComposer`.
 */

type FeedComposerSheetProps = {
  open: boolean;
  onClose: () => void;
  authorId: string;
  ownLink: string;
  postCost: number;
  prefillNonce: number;
  prefillBody: string;
  prefillTopic: ComposerDraft["topic"];
  prefillPoll: boolean;
  onSubmit: (draft: ComposerDraft) => Promise<boolean>;
};

export default function FeedComposerSheet({
  open,
  onClose,
  authorId,
  ownLink,
  postCost,
  prefillNonce,
  prefillBody,
  prefillTopic,
  prefillPoll,
  onSubmit,
}: FeedComposerSheetProps) {
  const fieldRef = useRef<HTMLTextAreaElement>(null);

  return (
    <Modal
      open={open}
      onClose={onClose}
      variant="fullscreen"
      title="New whisper"
      showClose
      initialFocus={fieldRef}
      /* Fullscreen has no backdrop to tap (the panel is the screen), so this
         only governs the desktop margins: off, because an accidental
         margin-tap that costs a half-written post is exactly the kind of loss
         a compose screen must never inflict. The X is the way out. */
      dismissOnBackdrop={false}
      className="feed-composer-sheet"
    >
      <div className="feed-composer-sheet-body">
        <FeedComposer
          variant="bare"
          authorId={authorId}
          ownLink={ownLink}
          postCost={postCost}
          fieldRef={fieldRef}
          prefillNonce={prefillNonce}
          prefillBody={prefillBody}
          prefillTopic={prefillTopic}
          prefillPoll={prefillPoll}
          onSubmit={async (draft) => {
            const posted = await onSubmit(draft);
            if (posted) onClose();
            return posted;
          }}
        />
      </div>
    </Modal>
  );
}
