"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion, type Variants } from "framer-motion";
import { RotateCcw, Send, Sparkles, TriangleAlert, X } from "lucide-react";

import { getCachedSession, onSessionChange } from "@/lib/supabase/session";
import { spring, tween, respectMotion } from "@/lib/motion";
import { useSafeReducedMotion } from "@/lib/useSafeReducedMotion";
import { useMediaQuery } from "@/lib/useMediaQuery";
import { vibrate } from "@/lib/haptics";
import {
  AI_LIMITS,
  QUICK_QUESTIONS,
  askWhispersAi,
  type AiTurn,
} from "@/lib/ai/whispersAi";
import {
  assistantHiddenOn,
  hasBottomNav,
  pageContextFor,
} from "@/lib/ai/pageContext";
import AiMessageText from "./AiMessageText";

/**
 * Whispers AI — the floating in-app assistant.
 *
 * Mounted once in the root layout, so the transcript survives navigation for the
 * length of the session and the user never has to leave the screen they're on to
 * ask a question. Nothing is persisted: closing the tab is the end of the
 * conversation, which is also why there is no database table behind this.
 *
 * Everything visual reads from the app's own tokens — `--theme-glass-strong`,
 * `--theme-accent-*`, `--elev-*` — and the composer reuses the chat screen's
 * `.chat-send-circle` so the send button is the same object the user already
 * knows from a conversation. No new colours are introduced.
 *
 * It renders for signed-in users only, and stays off the marketing, auth,
 * anonymous-send and chat routes (see `assistantHiddenOn`).
 */

type Bubble = { id: string; role: "user" | "assistant"; content: string };

/** Marks that the button has been noticed, so the attention ring shows once. */
const SEEN_KEY = "whisper-ai-seen";

/* --------------------------------------------------------------------------
 * "Has the button been noticed yet?"
 *
 * A one-bit store rather than `useState` + an effect that reads localStorage.
 * The server has no localStorage, so its snapshot is `true` — the ring is
 * absent from the server HTML and appears a frame later for a user who hasn't
 * opened the panel, instead of hydrating into a mismatch. Same shape as
 * `useSafeReducedMotion`, for the same reason.
 * ------------------------------------------------------------------------ */

let seenCache: boolean | null = null;
const seenListeners = new Set<() => void>();

function readSeen(): boolean {
  if (seenCache === null) {
    try {
      seenCache = window.localStorage.getItem(SEEN_KEY) === "true";
    } catch {
      // Private mode or storage disabled — treat as seen and skip the ring.
      seenCache = true;
    }
  }
  return seenCache;
}

function subscribeSeen(onChange: () => void) {
  seenListeners.add(onChange);
  return () => {
    seenListeners.delete(onChange);
  };
}

function markSeen() {
  if (seenCache === true) return;
  seenCache = true;
  try {
    window.localStorage.setItem(SEEN_KEY, "true");
  } catch {
    // The ring just shows again next session. Not worth handling further.
  }
  seenListeners.forEach((listener) => listener());
}

/** Composer never grows past this; it scrolls instead. */
const MAX_COMPOSER_HEIGHT = 116;

const GREETING =
  "Hi! I'm Whispers AI. Ask me anything about using Whisper — whispers, coins, chats, your link, or your settings.";

let bubbleCounter = 0;
function nextBubbleId() {
  bubbleCounter += 1;
  return `ai-${bubbleCounter}`;
}

const fabVariants: Variants = {
  hidden: { opacity: 0, scale: 0.6 },
  visible: { opacity: 1, scale: 1, transition: spring.bouncy },
  exit: { opacity: 0, scale: 0.7, transition: tween.fast },
};

const backdropVariants: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: tween.fast },
  exit: { opacity: 0, transition: tween.fast },
};

const desktopPanel: Variants = {
  hidden: { opacity: 0, scale: 0.94, y: 18 },
  visible: { opacity: 1, scale: 1, y: 0, transition: spring.smooth },
  exit: { opacity: 0, scale: 0.97, y: 10, transition: tween.fast },
};

const mobilePanel: Variants = {
  hidden: { opacity: 0, y: 28 },
  visible: { opacity: 1, y: 0, transition: spring.gentle },
  exit: { opacity: 0, y: 24, transition: tween.fast },
};

export default function WhispersAiAssistant() {
  const pathname = usePathname();
  const reduced = useSafeReducedMotion();
  /* `false` during hydration, which resolves to the mobile layout — the safe
      default, since the panel is closed on the first paint either way. */
  const isDesktop = useMediaQuery("(min-width: 640px)");

  const panelId = useId();

  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [open, setOpen] = useState(false);
  const seen = useSyncExternalStore(subscribeSeen, readSeen, () => true);

  const [messages, setMessages] = useState<Bubble[]>([]);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<{ message: string; retryable: boolean } | null>(null);
  const [canRetry, setCanRetry] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fabRef = useRef<HTMLButtonElement>(null);

  /* Read inside `ask`, which must not be re-created on every keystroke or
     every new bubble — a fresh identity there would re-run the effects that
     depend on it and lose the in-flight guard. */
  const messagesRef = useRef<Bubble[]>([]);
  const inFlightRef = useRef(false);
  const retryRef = useRef<{ question: string; history: AiTurn[] } | null>(null);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  /* --- Who's asking ----------------------------------------------------- */

  useEffect(() => {
    let cancelled = false;

    getCachedSession().then((session) => {
      if (!cancelled) setSignedIn(Boolean(session));
    });

    const unsubscribe = onSessionChange((session) => {
      if (cancelled) return;
      const next = Boolean(session);
      setSignedIn(next);
      /* Signing out mid-conversation must not leave the transcript sitting
         there for whoever signs in next. */
      if (!next) {
        setOpen(false);
        setMessages([]);
        setError(null);
        retryRef.current = null;
        setCanRetry(false);
      }
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  /* --- Presentation decisions -------------------------------------------- */

  const hidden = assistantHiddenOn(pathname);
  const liftForNav = hasBottomNav(pathname);

  /* Clear of the bottom tab bar where there is one (the bar is ~4.5rem tall
     plus its own 0.75rem inset), and a normal inset where there isn't. */
  const fabBottom = liftForNav
    ? "calc(env(safe-area-inset-bottom, 0px) + 6.25rem)"
    : "calc(env(safe-area-inset-bottom, 0px) + 1.5rem)";

  const context = useMemo(() => {
    const tab =
      typeof window !== "undefined"
        ? new URLSearchParams(window.location.search).get("tab")
        : null;
    return pageContextFor(pathname, tab);
    // `pathname` changing is what makes the tab worth re-reading.
  }, [pathname]);

  /* --- Asking ----------------------------------------------------------- */

  const ask = useCallback(
    async (question: string, options?: { replay?: boolean }) => {
      const trimmed = question.trim();
      if (!trimmed || inFlightRef.current) return;

      inFlightRef.current = true;
      setError(null);
      setCanRetry(false);
      setPending(true);

      /* On a retry the failed question is already in the transcript, so it must
         not be appended again — and the history has to be the one from the
         original attempt, or the model sees the question twice. */
      const history: AiTurn[] = options?.replay
        ? retryRef.current?.history ?? []
        : messagesRef.current.map((bubble) => ({
            role: bubble.role,
            content: bubble.content,
          }));

      if (!options?.replay) {
        setMessages((current) => [
          ...current,
          { id: nextBubbleId(), role: "user", content: trimmed },
        ]);
      }

      retryRef.current = { question: trimmed, history };

      const result = await askWhispersAi({ message: trimmed, history, context });

      setPending(false);
      inFlightRef.current = false;

      if (result.ok) {
        retryRef.current = null;
        setCanRetry(false);
        setMessages((current) => [
          ...current,
          { id: nextBubbleId(), role: "assistant", content: result.reply },
        ]);
        return;
      }

      setError({ message: result.message, retryable: result.retryable });
      setCanRetry(result.retryable);
    },
    [context]
  );

  const submitDraft = useCallback(() => {
    const question = draft.trim();
    if (!question || pending) return;
    setDraft("");
    if (inputRef.current) inputRef.current.style.height = "auto";
    void ask(question);
  }, [ask, draft, pending]);

  const retry = useCallback(() => {
    const previous = retryRef.current;
    if (!previous || pending) return;
    void ask(previous.question, { replay: true });
  }, [ask, pending]);

  const resetConversation = useCallback(() => {
    if (pending) return;
    setMessages([]);
    setError(null);
    retryRef.current = null;
    setCanRetry(false);
    setDraft("");
    inputRef.current?.focus();
  }, [pending]);

  const toggleOpen = useCallback(() => {
    setOpen((current) => {
      const next = !current;
      if (next && !seen) markSeen();
      return next;
    });
    vibrate(10);
  }, [seen]);

  /* --- Panel behaviour -------------------------------------------------- */

  /* Escape closes, and focus lands in the composer on open. Not a focus trap:
     this is a non-modal panel on desktop — the page behind it stays usable, and
     trapping focus in something the user hasn't been told is modal is worse for
     keyboard users than letting them Tab out. */
  useEffect(() => {
    if (!open) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setOpen(false);
      fabRef.current?.focus();
    }

    document.addEventListener("keydown", onKeyDown, true);
    const raf = requestAnimationFrame(() => inputRef.current?.focus());

    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open]);

  /* Stick to the bottom as the transcript grows. `scrollTop` rather than
     `scrollIntoView` so it can't scroll the page behind the panel. */
  useEffect(() => {
    if (!open) return;
    const node = scrollRef.current;
    if (!node) return;

    node.scrollTo({
      top: node.scrollHeight,
      behavior: reduced ? "auto" : "smooth",
    });
  }, [open, messages, pending, error, reduced]);

  if (hidden || !signedIn) return null;

  const overLimit = draft.length >= AI_LIMITS.MAX_QUESTION_CHARS - 60;
  const canSend = draft.trim().length > 0 && !pending;
  const showEmptyState = messages.length === 0 && !pending && !error;

  return (
    <>
      {/* Backdrop, phones only. On desktop the panel is a companion window, not
          a modal — dimming the app there would be a lie about what it blocks. */}
      <AnimatePresence>
        {open && !isDesktop && (
          <motion.div
            variants={backdropVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            onClick={() => setOpen(false)}
            aria-hidden
            className="fixed inset-0 z-[75]"
            style={{
              background: "rgba(4, 4, 10, 0.55)",
              backdropFilter: "blur(8px) saturate(140%)",
              WebkitBackdropFilter: "blur(8px) saturate(140%)",
            }}
          />
        )}
      </AnimatePresence>

      {/* --- The panel --- */}
      <AnimatePresence>
        {open && (
          <motion.section
            key="whispers-ai-panel"
            id={panelId}
            role="dialog"
            aria-label="Whispers AI assistant"
            variants={respectMotion(isDesktop ? desktopPanel : mobilePanel, reduced)}
            initial="hidden"
            animate="visible"
            exit="exit"
            className="fixed z-[80] flex flex-col overflow-hidden rounded-[1.75rem]"
            style={{
              transformOrigin: "bottom right",
              background: "var(--theme-glass-strong)",
              border: "1px solid var(--theme-glass-border)",
              boxShadow: "var(--elev-5), var(--elev-rim)",
              backdropFilter: "blur(32px) saturate(185%)",
              WebkitBackdropFilter: "blur(32px) saturate(185%)",
              color: "var(--theme-text)",
              ...(isDesktop
                ? {
                    right: "max(1.25rem, env(safe-area-inset-right, 0px))",
                    bottom: `calc(${fabBottom} + 4.5rem)`,
                    width: "22.5rem",
                    height: "min(34rem, calc(100dvh - 11rem))",
                  }
                : {
                    left: "max(0.5rem, env(safe-area-inset-left, 0px))",
                    right: "max(0.5rem, env(safe-area-inset-right, 0px))",
                    bottom: "max(0.5rem, env(safe-area-inset-bottom, 0px))",
                    height: "min(82dvh, 38rem)",
                  }),
            }}
          >
            {/* Header */}
            <header
              className="flex shrink-0 items-center gap-3 px-4 py-3.5"
              style={{ borderBottom: "1px solid var(--theme-glass-border)" }}
            >
              <span
                className="grid h-9 w-9 shrink-0 place-items-center rounded-2xl"
                style={{
                  background:
                    "linear-gradient(135deg, var(--theme-accent-from), var(--theme-accent-to))",
                  color: "var(--theme-accent-contrast)",
                  boxShadow:
                    "0 6px 16px -8px color-mix(in srgb, var(--theme-accent-purple) 80%, transparent)",
                }}
              >
                <Sparkles size={17} />
              </span>

              <span className="min-w-0 flex-1">
                <span className="card-title block truncate">Whispers AI</span>
                <span
                  className="block truncate text-[0.75rem]"
                  style={{ color: "var(--theme-text-muted)" }}
                >
                  {pending ? "Thinking…" : "Here to help you use Whisper"}
                </span>
              </span>

              {messages.length > 0 && (
                <button
                  type="button"
                  onClick={resetConversation}
                  disabled={pending}
                  aria-label="Start a new conversation"
                  title="Start a new conversation"
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-full transition-colors disabled:opacity-40"
                  style={{ color: "var(--theme-text-muted)" }}
                >
                  <RotateCcw size={16} />
                </button>
              )}

              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close Whispers AI"
                className="grid h-9 w-9 shrink-0 place-items-center rounded-full transition-colors"
                style={{ color: "var(--theme-text-muted)" }}
              >
                <X size={17} />
              </button>
            </header>

            {/* Transcript */}
            <div
              ref={scrollRef}
              className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 py-4"
              aria-live="polite"
              aria-busy={pending}
            >
              {showEmptyState ? (
                <div className="space-y-4">
                  <p
                    className="text-[0.875rem] leading-relaxed"
                    style={{ color: "var(--theme-text-secondary)" }}
                  >
                    {GREETING}
                  </p>

                  <div className="space-y-2">
                    <p className="eyebrow">Try asking</p>
                    <div className="flex flex-wrap gap-2">
                      {QUICK_QUESTIONS.map((question) => (
                        <button
                          key={question}
                          type="button"
                          onClick={() => void ask(question)}
                          className="rounded-full px-3 py-2 text-left text-[0.75rem] font-semibold transition-colors"
                          style={{
                            background: "var(--fill-2)",
                            border: "1px solid var(--theme-glass-border)",
                            color: "var(--theme-text)",
                          }}
                        >
                          {question}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                messages.map((bubble) => {
                  const mine = bubble.role === "user";

                  return (
                    <motion.div
                      key={bubble.id}
                      initial={reduced ? false : { opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={tween.base}
                      className={`flex ${mine ? "justify-end" : "justify-start"}`}
                    >
                      <div
                        className="max-w-[85%] rounded-2xl px-3.5 py-2.5 text-[0.8125rem] leading-relaxed"
                        style={
                          mine
                            ? {
                                background:
                                  "color-mix(in srgb, var(--theme-accent-purple) 20%, var(--theme-card))",
                                border:
                                  "1px solid color-mix(in srgb, var(--theme-accent-purple) 30%, transparent)",
                                color: "var(--theme-text)",
                                borderBottomRightRadius: "0.5rem",
                              }
                            : {
                                background: "var(--fill-2)",
                                border: "1px solid var(--theme-glass-border)",
                                color: "var(--theme-text)",
                                borderBottomLeftRadius: "0.5rem",
                              }
                        }
                      >
                        {mine ? (
                          <p className="whitespace-pre-wrap">{bubble.content}</p>
                        ) : (
                          <AiMessageText text={bubble.content} />
                        )}
                      </div>
                    </motion.div>
                  );
                })
              )}

              {/* Typing indicator */}
              {pending && (
                <motion.div
                  initial={reduced ? false : { opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={tween.fast}
                  className="flex justify-start"
                >
                  <div
                    className="flex items-center gap-1.5 rounded-2xl px-3.5 py-3"
                    style={{
                      background: "var(--fill-2)",
                      border: "1px solid var(--theme-glass-border)",
                      borderBottomLeftRadius: "0.5rem",
                    }}
                  >
                    <span className="sr-only">Whispers AI is typing</span>
                    {[0, 1, 2].map((dot) => (
                      <motion.span
                        key={dot}
                        className="block h-1.5 w-1.5 rounded-full"
                        style={{ background: "var(--theme-accent-purple)" }}
                        animate={reduced ? { opacity: 0.7 } : { opacity: [0.3, 1, 0.3], y: [0, -3, 0] }}
                        transition={
                          reduced
                            ? { duration: 0 }
                            : { duration: 1, repeat: Infinity, delay: dot * 0.14, ease: "easeInOut" }
                        }
                      />
                    ))}
                  </div>
                </motion.div>
              )}

              {/* Error + retry */}
              {error && (
                <motion.div
                  initial={reduced ? false : { opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={tween.base}
                  role="alert"
                  className="rounded-2xl px-3.5 py-3"
                  style={{
                    background: "color-mix(in srgb, var(--theme-error) 12%, transparent)",
                    border: "1px solid color-mix(in srgb, var(--theme-error) 32%, transparent)",
                  }}
                >
                  <div className="flex gap-2.5">
                    <TriangleAlert
                      size={16}
                      className="mt-0.5 shrink-0"
                      style={{ color: "var(--theme-error)" }}
                    />
                    <p className="text-[0.8125rem] leading-relaxed" style={{ color: "var(--theme-text)" }}>
                      {error.message}
                    </p>
                  </div>

                  {error.retryable && canRetry && (
                    <button
                      type="button"
                      onClick={retry}
                      disabled={pending}
                      className="mt-2.5 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[0.75rem] font-bold transition-colors disabled:opacity-50"
                      style={{
                        background: "var(--fill-3)",
                        color: "var(--theme-text)",
                      }}
                    >
                      <RotateCcw size={13} /> Retry
                    </button>
                  )}
                </motion.div>
              )}
            </div>

            {/* Composer */}
            <form
              onSubmit={(event) => {
                event.preventDefault();
                submitDraft();
              }}
              className="shrink-0 px-3 pb-3 pt-2.5"
              style={{ borderTop: "1px solid var(--theme-glass-border)" }}
            >
              <div
                className="flex items-end gap-2 rounded-[1.25rem] px-3 py-2"
                style={{
                  background: "var(--fill-1)",
                  border: "1px solid var(--theme-glass-border)",
                }}
              >
                <textarea
                  ref={inputRef}
                  value={draft}
                  onChange={(event) => {
                    setDraft(event.target.value);
                    const node = event.target;
                    node.style.height = "auto";
                    node.style.height = `${Math.min(node.scrollHeight, MAX_COMPOSER_HEIGHT)}px`;
                  }}
                  onKeyDown={(event) => {
                    /* Enter sends; Shift+Enter is a newline. `isComposing`
                       matters for IME input, where Enter commits a candidate
                       rather than finishing the sentence. */
                    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                      event.preventDefault();
                      submitDraft();
                    }
                  }}
                  rows={1}
                  maxLength={AI_LIMITS.MAX_QUESTION_CHARS}
                  placeholder="Ask about Whisper…"
                  aria-label="Ask Whispers AI"
                  className="max-h-[7.25rem] min-w-0 flex-1 resize-none bg-transparent py-1 text-[0.8125rem] leading-relaxed outline-none"
                  style={{ color: "var(--theme-text)" }}
                />

                <button
                  type="submit"
                  disabled={!canSend}
                  aria-label="Send question"
                  className="chat-send-circle chat-send-circle-press grid h-9 w-9 shrink-0 place-items-center rounded-full disabled:opacity-45"
                >
                  <Send size={15} />
                </button>
              </div>

              {/* Only appears when it's about to matter. */}
              {overLimit && (
                <p className="mt-1.5 text-right text-[0.6875rem]" style={{ color: "var(--theme-text-muted)" }}>
                  {draft.length}/{AI_LIMITS.MAX_QUESTION_CHARS}
                </p>
              )}
            </form>
          </motion.section>
        )}
      </AnimatePresence>

      {/* --- The button --- */}
      <AnimatePresence>
        {(!open || isDesktop) && (
          <motion.button
            key="whispers-ai-fab"
            ref={fabRef}
            type="button"
            onClick={toggleOpen}
            aria-expanded={open}
            aria-controls={panelId}
            aria-label={open ? "Close Whispers AI" : "Open Whispers AI"}
            variants={respectMotion(fabVariants, reduced)}
            initial="hidden"
            animate="visible"
            exit="exit"
            whileHover={reduced ? undefined : { y: -2 }}
            whileTap={reduced ? undefined : { scale: 0.92 }}
            className="no-press fixed z-[80] grid h-14 w-14 place-items-center rounded-full"
            style={{
              right: "max(1.25rem, env(safe-area-inset-right, 0px))",
              bottom: fabBottom,
              background:
                "linear-gradient(135deg, var(--theme-accent-from), var(--theme-accent-to))",
              color: "var(--theme-accent-contrast)",
              boxShadow:
                "0 12px 30px -10px color-mix(in srgb, var(--theme-accent-purple) 85%, transparent), var(--elev-3), inset 0 1px 0 rgba(255, 255, 255, 0.22)",
            }}
          >
            {/* Shown until the button has been opened once. A single soft ring,
                not a badge — there's nothing to count. */}
            {!seen && !reduced && (
              <motion.span
                aria-hidden
                className="pointer-events-none absolute inset-0 rounded-full"
                style={{ border: "2px solid var(--theme-accent-purple)" }}
                animate={{ opacity: [0.55, 0, 0.55], scale: [1, 1.35, 1] }}
                transition={{ duration: 2.4, repeat: Infinity, ease: "easeOut" }}
              />
            )}

            <motion.span
              key={open ? "close" : "open"}
              initial={reduced ? false : { opacity: 0, rotate: -70, scale: 0.7 }}
              animate={{ opacity: 1, rotate: 0, scale: 1 }}
              transition={spring.snappy}
              className="grid place-items-center"
            >
              {open ? <X size={22} /> : <Sparkles size={21} />}
            </motion.span>
          </motion.button>
        )}
      </AnimatePresence>
    </>
  );
}
