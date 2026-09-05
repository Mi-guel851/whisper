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
      variant="sheet"
      title="New whisper"
      showClose
      initialFocus={fieldRef}
      /* Backdrop dismiss stays on, but the draft survives it — the sheet only
         unmounts the composer when the page drops `open`, and reopening restores
         nothing, so an accidental tap outside costs the text. Keeping it means
         the panel behaves like every other sheet in the app; the drag handle and
         the close button are both faster ways out for anyone who meant it. */
      dismissOnBackdrop
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
