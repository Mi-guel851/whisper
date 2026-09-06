"use client";

/**
 * The picker shell: Emoji · GIF · Stickers · Created, in one panel that sits
 * between the thread and the composer.
 *
 * WHY IT IS IN-FLOW RATHER THAN AN OVERLAY
 * The chat page is a `.viewport-frame` — a flex column pinned to the visual
 * viewport, with the message list as the one flexible row. Rendering the
 * picker as a flex sibling above the composer means opening it *shrinks the
 * thread* exactly the way the keyboard does, the composer never moves, and
 * the keyboard-swap interaction (tap the input → keyboard replaces picker)
 * is just this row unmounting while the OS keyboard takes the same space.
 * A `position: fixed` sheet would fight the visual-viewport math the frame
 * exists to solve — WhatsApp does it this way for the same reason.
 *
 * Height: ~40% of the frame on phones (capped), a fixed 380px on desktop
 * where the frame is tall and the picker hangs from the composer like a
 * popover. Animated with a spring on max-height opacity via Framer Motion,
 * which is already in the bundle.
 */

import { motion, AnimatePresence } from "framer-motion";
import { lazy, Suspense } from "react";
import { Smile, Clapperboard, Sticker as StickerIcon, Sparkles } from "lucide-react";
import type { GifResult, StickerDef } from "@/lib/chatMedia";

/* Each tab is its own chunk: the emoji JSON, the GIF grid and the sticker
   maker only download when their tab first renders. */
const EmojiPanel = lazy(() => import("./EmojiPanel"));
const GifPanel = lazy(() => import("./GifPanel"));
const StickerPanel = lazy(() => import("./StickerPanel"));
const MyStickersPanel = lazy(() => import("./MyStickersPanel"));

export type MediaTab = "emoji" | "gif" | "stickers" | "created";

const TABS: { id: MediaTab; label: string; icon: typeof Smile }[] = [
  { id: "emoji", label: "Emoji", icon: Smile },
  { id: "gif", label: "GIFs", icon: Clapperboard },
  { id: "stickers", label: "Stickers", icon: StickerIcon },
  { id: "created", label: "Created", icon: Sparkles },
];

export default function MediaPicker({
  open,
  tab,
  onTabChange,
  userId,
  onPickEmoji,
  onPickGif,
  onPickSticker,
  sendingMedia,
  showToast,
  isDesktop,
}: {
  open: boolean;
  tab: MediaTab;
  onTabChange: (tab: MediaTab) => void;
  userId: string;
  onPickEmoji: (emoji: string) => void;
  onPickGif: (gif: GifResult) => void;
  onPickSticker: (sticker: StickerDef) => void;
  /** URL currently being sent, so grids can show a spinner on that item. */
  sendingMedia: string | null;
  showToast: (message: string) => void;
  isDesktop: boolean;
}) {
  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          key="media-picker"
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ type: "spring", stiffness: 480, damping: 42, mass: 0.7 }}
          className={`chat-context-recede relative z-10 flex-shrink-0 overflow-hidden ${
            isDesktop ? "md:mx-6 md:mb-1" : ""
          }`}
        >
          <div
            className={`chat-chrome relative flex flex-col overflow-hidden border-t ${
              isDesktop ? "rounded-2xl border shadow-xl" : "rounded-t-2xl"
            }`}
            style={{
              height: isDesktop ? 380 : "min(46vh, 340px)",
              boxShadow: "var(--chat-panel-shadow)",
            }}
            role="region"
            aria-label="Emoji, GIF and sticker picker"
          >
            {/* Tab bar */}
            <div
              className="flex shrink-0 items-center gap-1 overflow-x-auto border-b px-2 py-1.5"
              style={{ borderColor: "var(--chat-chrome-bd)" }}
              role="tablist"
              aria-label="Picker sections"
            >
              {TABS.map(({ id, label, icon: Icon }) => {
                const active = tab === id;
                return (
                  <button
                    key={id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => onTabChange(id)}
                    className={`relative flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-bold transition ${
                      active ? "" : "chat-meta hover:opacity-80"
                    }`}
                    style={
                      active
                        ? {
                            background:
                              "color-mix(in srgb, var(--theme-accent-purple) 16%, transparent)",
                            color: "var(--theme-accent-purple)",
                          }
                        : undefined
                    }
                  >
                    <Icon size={15} />
                    {label}
                    {active && (
                      <motion.span
                        layoutId="media-tab-underline"
                        className="absolute inset-x-3 -bottom-[7px] h-0.5 rounded-full"
                        style={{
                          background:
                            "linear-gradient(90deg, var(--theme-accent-from), var(--theme-accent-to))",
                        }}
                      />
                    )}
                  </button>
                );
              })}
            </div>

            {/* Active panel */}
            <div className="relative min-h-0 flex-1">
              <Suspense
                fallback={
                  <div className="flex h-full items-center justify-center">
                    <span className="h-6 w-6 animate-spin rounded-full border-2 border-[var(--chat-meta)] border-t-transparent" />
                  </div>
                }
              >
                {tab === "emoji" && <EmojiPanel onPick={onPickEmoji} />}
                {tab === "gif" && <GifPanel onPick={onPickGif} sending={sendingMedia} />}
                {tab === "stickers" && (
                  <StickerPanel onPick={onPickSticker} sending={sendingMedia} />
                )}
                {tab === "created" && (
                  <MyStickersPanel
                    userId={userId}
                    onPick={onPickSticker}
                    sending={sendingMedia}
                    showToast={showToast}
                  />
                )}
              </Suspense>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
