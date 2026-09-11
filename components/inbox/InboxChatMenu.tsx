"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Pin, PinOff, MailCheck, MailOpen, ShieldBan, ShieldCheck } from "lucide-react";

/**
 * WhatsApp-style long-press (or right-click) menu for a chat row.
 *
 * A press-and-hold on a row is the discovery surface: a small action sheet
 * appears beside the finger with the row choices — Pin / Unpin, Mark as
 * read/unread, and Block (or Unblock). Tapping a row normally still opens the
 * conversation; only a held press (or a desktop right-click / long mouse-hold)
 * opens this sheet, so it never steals the tap that opens a chat.
 *
 * BLOCK IS SET APART
 *
 * Blocking is the only destructive item here, so it gets a divider, its own
 * colour, and it does NOT act on tap: it hands the decision back to the page,
 * which asks for a confirmation. Everything else in this sheet is a toggle the
 * user can undo by repeating it; a block is not, and a menu that treats them
 * the same is a menu that blocks people by accident.
 *
 * The sheet dismisses on outside tap, scroll, Escape, or after an action.
 */

export type InboxChatMenuProps = {
  open: boolean;
  /** Viewport anchor for the sheet. The sheet flips above the finger near the
      bottom of the list so it never renders off-screen. */
  anchor: { x: number; y: number } | null;
  isPinned: boolean;
  isUnread: boolean;
  /** True when this user has blocked the row's person (not the other way
      round — being blocked is never disclosed here). */
  isBlocked?: boolean;
  onPin: () => void;
  onToggleRead: () => void;
  /** Asks for confirmation on the page; the sheet just closes. */
  onBlock?: () => void;
  onClose: () => void;
};

export default function InboxChatMenu({
  open,
  anchor,
  isPinned,
  isUnread,
  isBlocked = false,
  onPin,
  onToggleRead,
  onBlock,
  onClose,
}: InboxChatMenuProps) {
  const sheetRef = useRef<HTMLDivElement>(null);

  /* Outside-press and Escape close the sheet. A microtask delay is used so the
     very pointerup that opened it does not immediately count as "outside". */
  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (sheetRef.current && !sheetRef.current.contains(event.target as Node)) {
        onClose();
      }
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
      const items = Array.from(sheetRef.current?.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]') ?? []);
      if (!items.length) return;
      const current = items.indexOf(document.activeElement as HTMLButtonElement);
      let next: number | undefined;
      if (event.key === "ArrowDown") next = (current + 1) % items.length;
      if (event.key === "ArrowUp") next = (current - 1 + items.length) % items.length;
      if (event.key === "Home") next = 0;
      if (event.key === "End") next = items.length - 1;
      if (next !== undefined) { event.preventDefault(); items[next].focus(); }
      if (event.key === "Tab") onClose();
    }
    const timer = window.setTimeout(() => {
      document.addEventListener("pointerdown", onPointerDown, true);
    }, 0);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onClose, true);
    window.addEventListener("resize", onClose);
    const previousFocus = document.activeElement as HTMLElement | null;
    const focusTimer = window.setTimeout(() => sheetRef.current?.querySelector<HTMLButtonElement>("button")?.focus(), 0);
    return () => {
      window.clearTimeout(timer);
      window.clearTimeout(focusTimer);
      window.removeEventListener("scroll", onClose, true);
      window.removeEventListener("resize", onClose);
      previousFocus?.focus({ preventScroll: true });
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  const items = [
    {
      key: "pin",
      label: isPinned ? "Unpin chat" : "Pin chat",
      icon: isPinned ? PinOff : Pin,
      onSelect: () => {
        onPin();
        onClose();
      },
    },
    {
      key: "read",
      label: isUnread ? "Mark as read" : "Mark as unread",
      icon: isUnread ? MailCheck : MailOpen,
      onSelect: () => {
        onToggleRead();
        onClose();
      },
    },
  ];

  /* Flip above the anchor when the tap was in the bottom third of the screen,
     so the sheet always has room. */
  if (typeof document === "undefined") return null;

  const flipUp = anchor ? anchor.y > window.innerHeight * 0.66 : false;

  return createPortal(
    <AnimatePresence>
      {open && anchor && (
        <>
          {/* The whole screen is a dismiss target, mirroring WhatsApp. */}
          <div className="fixed inset-0 z-[1000] bg-black/30" onClick={onClose} aria-hidden />
          <motion.div
            ref={sheetRef}
            initial={{ opacity: 0, scale: 0.92, y: flipUp ? 6 : -6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: flipUp ? 4 : -4 }}
            transition={{ duration: 0.14, ease: "easeOut" }}
            role="menu"
            className="overlay-surface fixed z-[1001] w-48 overflow-hidden rounded-2xl border p-1 shadow-2xl"
            style={{
              left: Math.max(8, Math.min(anchor.x, window.innerWidth - 200)),
              top: flipUp ? undefined : Math.max(8, anchor.y),
              bottom: flipUp ? Math.max(8, window.innerHeight - anchor.y) : undefined,
              touchAction: "none",
            }}
          >
            {items.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.key}
                  type="button"
                  role="menuitem"
                  onClick={item.onSelect}
                  className="chat-menu-item flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[13.5px] font-semibold"
                >
                  <Icon size={16} className="shrink-0 opacity-80" />
                  {item.label}
                </button>
              );
            })}

            {onBlock && (
              <>
                <div className="my-1 h-px bg-white/10" aria-hidden />
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    /* Close first: the confirmation dialog is the modal the
                       user must answer, and two stacked overlays under one
                       finger is how the wrong button gets pressed. */
                    onClose();
                    onBlock();
                  }}
                  className={`chat-menu-item flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[13.5px] font-semibold ${
                    isBlocked ? "" : "text-red-300"
                  }`}
                >
                  {isBlocked ? (
                    <ShieldCheck size={16} className="shrink-0 opacity-80" />
                  ) : (
                    <ShieldBan size={16} className="shrink-0 opacity-80" />
                  )}
                  {isBlocked ? "Unblock" : "Block"}
                </button>
              </>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>,
    document.body
  );
}
