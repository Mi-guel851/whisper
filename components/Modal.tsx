"use client";

import { useCallback, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";
import { backdrop, modalIn, sheetUp } from "@/lib/motion";

type ModalProps = {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  title?: string;
  description?: string;
  /** "sheet" slides up from the bottom edge — better on phones. */
  variant?: "center" | "sheet";
  size?: "sm" | "md" | "lg";
  showClose?: boolean;
  /** Set false for destructive flows that must be answered explicitly. */
  dismissOnBackdrop?: boolean;
  className?: string;
  /**
   * The element focus should land on when the dialog opens, ahead of the
   * first focusable child.
   *
   * Without this, the open-time focus goes to the first focusable element in
   * DOM order — which, in any panel with a close button, is the close button,
   * because it precedes the content. For dialogs whose whole purpose is text
   * entry that is one tap wrong: the field the person opened the dialog to use
   * is left a second tap away, and a keyboard that a child's focus() effect
   * did raise gets dismissed again the frame after, when this dialog's own
   * focus lands elsewhere. The composer sheet passes its textarea here so
   * every open goes straight into the field.
   */
  initialFocus?: React.RefObject<HTMLElement | null>;
};

const sizeClasses = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-lg",
};

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * The base for every dialog in the app.
 *
 * Handles the things that are easy to forget and obvious when missing:
 * portalling out of transformed ancestors, scroll lock, Escape, focus trap,
 * and restoring focus to whatever opened it.
 */
export default function Modal({
  open,
  onClose,
  children,
  title,
  description,
  variant = "center",
  size = "md",
  showClose = true,
  dismissOnBackdrop = true,
  className = "",
  initialFocus,
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  // Escape to dismiss + focus trap.
  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
        return;
      }

      if (event.key !== "Tab" || !panelRef.current) return;

      const focusable = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)
      ).filter((el) => el.offsetParent !== null);

      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;

      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    },
    [onClose]
  );

  useEffect(() => {
    if (!open) return;

    restoreFocusRef.current = document.activeElement as HTMLElement | null;

    // Lock scroll without the layout shift that removing the scrollbar causes.
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
    const { overflow, paddingRight } = document.body.style;
    document.body.style.overflow = "hidden";
    if (scrollbarWidth > 0) document.body.style.paddingRight = `${scrollbarWidth}px`;

    document.addEventListener("keydown", handleKeyDown, true);

    // Focus the panel on the next frame, after the entrance has mounted. A
    // caller-nominated element wins; it is in place by then because the
    // content mounts in the same commit as this effect.
    const raf = requestAnimationFrame(() => {
      const target =
        initialFocus?.current ??
        panelRef.current?.querySelector<HTMLElement>(FOCUSABLE) ??
        panelRef.current;
      target?.focus();
    });

    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("keydown", handleKeyDown, true);
      document.body.style.overflow = overflow;
      document.body.style.paddingRight = paddingRight;
      restoreFocusRef.current?.focus?.();
    };
  }, [open, handleKeyDown, initialFocus]);

  if (typeof document === "undefined") return null;

  const isSheet = variant === "sheet";

  return createPortal(
    <AnimatePresence>
      {open && (
        <div
          className={`fixed inset-0 z-[999] flex ${
            isSheet ? "items-end" : "items-center"
          } justify-center ${isSheet ? "" : "p-4"}`}
        >
          <motion.div
            variants={backdrop}
            initial="hidden"
            animate="visible"
            exit="exit"
            onClick={dismissOnBackdrop ? onClose : undefined}
            className="absolute inset-0"
            style={{
              background: "rgba(4, 4, 10, 0.6)",
              backdropFilter: "blur(10px) saturate(140%)",
              WebkitBackdropFilter: "blur(10px) saturate(140%)",
            }}
          />

          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label={title}
            tabIndex={-1}
            variants={isSheet ? sheetUp : modalIn}
            initial="hidden"
            animate="visible"
            exit="exit"
            drag={isSheet ? "y" : false}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.4 }}
            onDragEnd={(_, info) => {
              // Flick down, or drag past a third of the sheet, to dismiss.
              if (info.offset.y > 120 || info.velocity.y > 600) onClose();
            }}
            className={`relative w-full outline-none ${
              isSheet ? "rounded-t-[1.75rem]" : `${sizeClasses[size]} rounded-[1.5rem]`
            } ${className}`}
            style={{
              background: "var(--theme-glass-strong)",
              border: "1px solid var(--theme-glass-border)",
              boxShadow: "var(--elev-5), var(--elev-rim)",
              backdropFilter: "blur(36px) saturate(190%)",
              WebkitBackdropFilter: "blur(36px) saturate(190%)",
            }}
          >
            {isSheet && (
              <div className="flex justify-center pt-3">
                <span
                  className="h-1 w-10 rounded-full"
                  style={{ background: "var(--fill-4)" }}
                />
              </div>
            )}

            {showClose && (
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="absolute right-3 top-3 z-10 grid h-9 w-9 place-items-center rounded-full transition-colors"
                style={{ color: "var(--theme-text-muted)" }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "var(--fill-2)";
                  e.currentTarget.style.color = "var(--theme-text)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "transparent";
                  e.currentTarget.style.color = "var(--theme-text-muted)";
                }}
              >
                <X size={17} />
              </button>
            )}

            {(title || description) && (
              <header className={`px-6 ${isSheet ? "pt-4" : "pt-6"} pb-2`}>
                {title && (
                  <h2
                    className="pr-8 text-[1.25rem] font-bold"
                    style={{
                      color: "var(--theme-text)",
                      letterSpacing: "var(--tracking-xl)",
                    }}
                  >
                    {title}
                  </h2>
                )}
                {description && (
                  <p
                    className="mt-1.5 text-[0.875rem]"
                    style={{ color: "var(--theme-text-secondary)" }}
                  >
                    {description}
                  </p>
                )}
              </header>
            )}

            {children}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body
  );
}
