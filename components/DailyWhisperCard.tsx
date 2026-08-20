"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Copy, RefreshCw, Share2, Sparkles, Sun } from "lucide-react";

import EdgeLitCard from "@/components/EdgeLitCard";
import Button from "@/components/Button";
import { HAPTIC, vibrate } from "@/lib/haptics";
import { fadeUp, respectMotion, spring, tween } from "@/lib/motion";
import useSafeReducedMotion from "@/lib/useSafeReducedMotion";
import useWhisperShare from "@/lib/useWhisperShare";
import {
  formatPromptDate,
  nextPrompt,
  promptForDate,
  PROMPT_CATEGORIES,
  type PromptCategory,
  type WhisperPrompt,
} from "@/lib/dailyWhisper";

/**
 * Daily Whisper.
 *
 * The point of this card is not the prompt — it's the share. A Whisper link on
 * its own asks nothing, so it gets ignored; a link that arrives attached to
 * "What's my biggest red flag?" gets answered. So the prompt *is* the share
 * caption, and the primary button sends both together.
 *
 * WHY THE PROMPT ARRIVES IN AN EFFECT
 *
 * `promptForDate` reads the local calendar date, and a client component still
 * renders once on the server to produce the initial HTML. The server is on UTC,
 * so for anyone whose local date differs from UTC's the server would pick a
 * different prompt than the browser and React would report a hydration mismatch —
 * then throw away the markup and re-render. Resolving the date in an effect keeps
 * the first paint deterministic and the reconciliation clean. The card renders its
 * own shape immediately either way, so nothing shifts when the text lands.
 */

const CATEGORY_STORAGE_KEY = "whisper:prompt-category";

export default function DailyWhisperCard() {
  const reduced = useSafeReducedMotion();
  const { sharePrompt, copyPrompt } = useWhisperShare();

  const [prompt, setPrompt] = useState<WhisperPrompt | null>(null);
  const [today, setToday] = useState("");
  const [category, setCategory] = useState<PromptCategory>("random");
  const [generating, setGenerating] = useState(false);

  /** Handle for the shuffle icon's spin, so it can be cleared. */
  const spinTimer = useRef<number | null>(null);

  /* The prompt is today's until the user shuffles. Tracked so the header can say
     which one they're looking at — "Today's Whisper" is a promise the card
     shouldn't keep making once the text has been changed by hand. */
  const [isToday, setIsToday] = useState(true);

  useEffect(() => {
    const now = new Date();
    setPrompt(promptForDate(now));
    setToday(formatPromptDate(now));

    /* Remembered so the generator opens where the user left it. Wrapped because
       Safari in private mode throws on localStorage rather than returning null. */
    try {
      const saved = window.localStorage.getItem(CATEGORY_STORAGE_KEY);
      if (saved && PROMPT_CATEGORIES.some((entry) => entry.key === saved)) {
        setCategory(saved as PromptCategory);
      }
    } catch {
      /* No persistence available. The default is fine. */
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadLink() {
      const session = await getCachedSession();
      if (!session || cancelled) return;

      const { data } = await supabase
        .from("profiles")
        .select("username")
        .eq("id", session.user.id)
        .maybeSingle();

      if (!cancelled && data?.username) {
        setLink(`${window.location.origin}/u/${data.username}`);
      }
    }

    void loadLink();
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * What actually gets shared.
   *
   * The prompt, then the link, on separate lines. Not a single run-on sentence:
   * WhatsApp and Instagram both linkify a trailing URL and leave preceding text
   * alone, so a link on its own line stays tappable while the question stays
   * readable.
   */
  const shareText = useMemo(() => {
    if (!prompt) return "";
    return `${prompt.text}\n\nTell me anonymously 👇\n${link}`;
  }, [prompt, link]);

  const copy = useCallback(
    async (text: string, message: string) => {
      try {
        await navigator.clipboard.writeText(text);
        vibrate(HAPTIC.success);
        showToast(message);
      } catch {
        /* Clipboard is permission-gated and refuses outright in some in-app
           browsers. Saying so beats a button that silently does nothing. */
        showToast("Couldn't copy — long-press the text to copy it manually.");
      }
    },
    [showToast]
  );

  const share = useCallback(async () => {
    if (!prompt) return;

    if (!link) {
      showToast("Finish setting up your username to share your Whisper.");
      return;
    }

    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({ title: "Whisper", text: shareText });
        vibrate(HAPTIC.success);
        return;
      } catch {
        /* Cancelled, or the sheet refused. Falling through to the clipboard
           would double-handle a deliberate cancel, so just stop. */
        return;
      }
    }

    await copy(shareText, "Prompt and link copied ✓");
  }, [prompt, link, shareText, copy, showToast]);

  const shuffle = useCallback(() => {
    setPrompt((current) => nextPrompt(category, current?.id));
    setIsToday(false);
    setGenerating(true);
    vibrate(HAPTIC.select);

    /* Purely cosmetic: the new prompt is ready instantly, but the spin needs a
       beat to be legible. Tracked in a ref and cleared on unmount — and cleared
       before re-arming, so hammering the button doesn't leave one timer to
       switch the icon off while a later spin is still running. */
    if (spinTimer.current !== null) window.clearTimeout(spinTimer.current);
    spinTimer.current = window.setTimeout(() => {
      spinTimer.current = null;
      setGenerating(false);
    }, 420);
  }, [category]);

  useEffect(
    () => () => {
      if (spinTimer.current !== null) window.clearTimeout(spinTimer.current);
    },
    []
  );

  const pickCategory = useCallback(
    (next: PromptCategory) => {
      setCategory(next);
      setPrompt(nextPrompt(next));
      setIsToday(false);
      vibrate(HAPTIC.tap);
      try {
        window.localStorage.setItem(CATEGORY_STORAGE_KEY, next);
      } catch {
        /* Not persisting is not worth surfacing. */
      }
    },
    []
  );

  const backToToday = useCallback(() => {
    const now = new Date();
    setPrompt(promptForDate(now));
    setIsToday(true);
    vibrate(HAPTIC.tap);
  }, []);

  return (
    <EdgeLitCard radius="3xl" intensity={0.4} speed={17} innerClassName="p-6">
      <div className="flex items-center justify-between gap-3">
        <div className="eyebrow flex items-center gap-2 text-amber-300">
          <Sun size={14} />
          <span>{isToday ? "Today's Whisper" : "Your Prompt"}</span>
        </div>

        {isToday ? (
          <span className="text-[11px] font-semibold theme-text-subtle">{today}</span>
        ) : (
          <button
            type="button"
            onClick={backToToday}
            className="text-[11px] font-bold text-amber-300/90 underline decoration-dotted underline-offset-2"
          >
            Back to today
          </button>
        )}
      </div>

      {/* Fixed minimum height so swapping a one-line prompt for a three-line one
          doesn't move the buttons under the user's thumb mid-tap. */}
      <div className="relative mt-3 flex min-h-[5.5rem] items-start">
        <AnimatePresence mode="wait" initial={false}>
          <motion.h2
            key={prompt?.id ?? "loading"}
            variants={respectMotion(fadeUp, reduced)}
            initial="hidden"
            animate="visible"
            exit="exit"
            className="section-title text-white"
          >
            {prompt?.text ?? " "}
          </motion.h2>
        </AnimatePresence>
      </div>

      <div className="mt-4 flex gap-3">
        <Button
          className="flex-1"
          onClick={share}
          disabled={!prompt}
          icon={<Share2 size={16} />}
        >
          Share
        </Button>
        <Button
          variant="secondary"
          onClick={() => prompt && copy(prompt.text, "Prompt copied ✓")}
          disabled={!prompt}
          icon={<Copy size={16} />}
          aria-label="Copy prompt"
        >
          Copy
        </Button>
        <motion.button
          type="button"
          onClick={shuffle}
          aria-label="Generate another prompt"
          className="glass-control flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-purple-200"
          whileTap={reduced ? undefined : { scale: 0.92 }}
          transition={spring.snappy}
        >
          <motion.span
            animate={generating && !reduced ? { rotate: 360 } : { rotate: 0 }}
            transition={generating ? { duration: 0.42, ease: "easeInOut" } : tween.fast}
            className="flex"
          >
            <RefreshCw size={17} />
          </motion.span>
        </motion.button>
      </div>

      {/* The generator. Not a separate screen: the prompt is already here, so
          changing its flavour belongs on the same card rather than behind a
          navigation step. */}
      <div className="mt-5">
        <div className="eyebrow mb-2 flex items-center gap-1.5 text-purple-300">
          <Sparkles size={12} />
          <span>Generate a prompt</span>
        </div>

        {/* Horizontal scroll rather than a wrap: eight chips wrapped to three
            rows on a phone and pushed the card's own content off the fold. */}
        <div
          className="daily-chip-row -mx-1 flex gap-2 overflow-x-auto px-1 pb-1"
          style={{ scrollbarWidth: "none" }}
        >
          {PROMPT_CATEGORIES.map((entry) => {
            const active = entry.key === category;
            return (
              <button
                key={entry.key}
                type="button"
                onClick={() => pickCategory(entry.key)}
                aria-pressed={active}
                className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-bold transition-colors ${
                  active ? "daily-chip-active" : "daily-chip"
                }`}
              >
                <span aria-hidden>{entry.emoji}</span>
                {entry.label}
              </button>
            );
          })}
        </div>
      </div>
    </EdgeLitCard>
  );
}
