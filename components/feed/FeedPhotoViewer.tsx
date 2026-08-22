"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { spring, tween } from "@/lib/motion";

/**
 * Fullscreen photo viewer.
 *
 * Deliberately not built on `Modal`. Modal is a glass panel with a title, a
 * close button and padding — the right frame for a form and the wrong one for a
 * photograph, which wants the whole screen and no chrome competing with it. What
 * this borrows from Modal is only the parts that are about correctness: a
 * portal so it escapes transformed ancestors, Escape to dismiss, and a scroll
 * lock so the feed doesn't move underneath.
 *
 * The `src` is an object URL for bytes that will never be served again. The page
 * owns it and revokes it on close — doing that here would race the exit
 * animation and blank the image on its way out.
 */

type FeedPhotoViewerProps = {
  src: string | null;
  onClose: () => void;
};

export default function FeedPhotoViewer({ src, onClose }: FeedPhotoViewerProps) {
  const open = Boolean(src);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKeyDown, true);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open, onClose]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="feed-photo-viewer"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={tween.fast}
          role="dialog"
          aria-modal="true"
          aria-label="Photo"
          onClick={onClose}
        >
          <motion.img
            src={src ?? undefined}
            alt="Photo from a whisper"
            className="feed-photo-full"
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.94, opacity: 0, transition: tween.fast }}
            transition={spring.smooth}
            /* Flick down to dismiss, the gesture a fullscreen image already
               implies on both platforms. Constrained to y so a horizontal drag
               doesn't half-move the photo and then snap back. */
            drag="y"
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={0.35}
            onDragEnd={(_, info) => {
              if (Math.abs(info.offset.y) > 120 || Math.abs(info.velocity.y) > 640) onClose();
            }}
            onClick={(event) => event.stopPropagation()}
            draggable={false}
          />

          <button
            type="button"
            onClick={onClose}
            aria-label="Close photo"
            className="feed-photo-close"
          >
            <X size={20} />
          </button>

          <p className="feed-photo-spent-note">
            This was your one look — it&apos;s gone now.
          </p>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}
