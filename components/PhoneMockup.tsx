"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Play, Send, Signal, Wifi, BatteryFull, MoreVertical } from "lucide-react";
import Image from "next/image";
import { spring, tween } from "@/lib/motion";
import { useSafeReducedMotion } from "@/lib/useSafeReducedMotion";

/**
 * Marketing mockup: an anonymous conversation playing out on a phone.
 *
 * The loop is intentional. Emil's frequency rule says to strip animation from
 * things users see constantly — but this *is* the explanation of the product,
 * seen once on the landing page, so looping is what makes it legible. It's also
 * the only place a visitor sees the actual app before signing up, so the script
 * deliberately covers the four message kinds Whisper supports rather than three
 * text bubbles: text, reaction, photo, and voice note.
 *
 * Note `data-surface="dark"`: the phone screen renders the dark app UI in both
 * themes. Without the opt-out, the light-theme compatibility bridge in
 * globals.css would repaint `text-white` to near-black and the screen would go
 * blank.
 */

type Beat =
  | { kind: "in" | "out"; text: string; time: string; reaction?: string }
  | { kind: "photo"; time: string; reaction?: string }
  | { kind: "voice"; time: string; length: string };

const SCRIPT: readonly Beat[] = [
  { kind: "in", text: "Hey…", time: "9:41 PM" },
  {
    kind: "in",
    text: "I don't know you personally, but you're one of the nicest people I've met.",
    time: "9:43 PM",
    reaction: "❤️",
  },
  { kind: "out", text: "You deserved to hear that.", time: "9:44 PM", reaction: "❤️" },
  { kind: "photo", time: "9:45 PM", reaction: "😍" },
  { kind: "voice", time: "9:46 PM", length: "0:12" },
];

/** Milliseconds the typing indicator holds before each beat lands. */
const TYPING_MS = 1150;
/** Milliseconds a beat is left on screen before the next one starts typing. */
const READ_MS = 1250;
/** Milliseconds the finished thread rests before it clears and replays. */
const RESET_MS = 3400;

/* -------------------------------------------------------------------------- */

const BUBBLE_IN = "rgba(255, 255, 255, 0.09)";
const BUBBLE_OUT = "linear-gradient(135deg, rgba(139, 92, 246, 0.9), rgba(168, 85, 247, 0.72))";

/**
 * The heart/eyes chip that overlaps a bubble's lower edge.
 *
 * Module scope, not a nested helper: a component declared inside the render
 * function is a brand-new type on every tick of the script, so every reaction
 * would unmount and remount — and the pop animation would replay each time.
 */
function Reaction({ emoji }: { emoji: string }) {
  return (
    <motion.span
      className="absolute -bottom-2.5 -right-1 grid h-6 w-6 place-items-center rounded-full text-[11px]"
      style={{
        background: "rgba(20, 12, 32, 0.92)",
        border: "1px solid rgba(255, 255, 255, 0.14)",
      }}
      initial={{ scale: 0 }}
      animate={{ scale: 1 }}
      transition={{ ...spring.bouncy, delay: 0.35 }}
    >
      {emoji}
    </motion.span>
  );
}

/** Static waveform for the voice note. Same two-sine envelope as `MiniViz`. */
function VoiceBars() {
  return (
    <div className="flex h-5 flex-1 items-center gap-[2px]">
      {Array.from({ length: 26 }, (_, index) => (
        <span
          key={index}
          className="w-[2px] shrink-0 rounded-full"
          style={{
            height: `${20 + Math.abs(Math.sin(index * 0.62) * Math.cos(index * 0.27)) * 80}%`,
            background:
              index < 9 ? "#c4b5fd" : "rgba(255, 255, 255, 0.32)",
          }}
        />
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

export default function PhoneMockup() {
  const [shown, setShown] = useState(0);
  const [typing, setTyping] = useState(false);
  const reduced = useSafeReducedMotion();

  // Held in a ref rather than state: the timeline reschedules itself, and
  // storing pending handles in state would re-render on every schedule.
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    const pending = timers.current;

    function schedule(fn: () => void, delay: number) {
      pending.push(setTimeout(fn, delay));
    }

    let index = 0;

    function advance() {
      if (index >= SCRIPT.length) {
        schedule(() => {
          setShown(0);
          index = 0;
          advance();
        }, RESET_MS);
        return;
      }

      setTyping(true);
      schedule(() => {
        setTyping(false);
        index += 1;
        setShown(index);
        schedule(advance, READ_MS);
      }, TYPING_MS);
    }

    advance();

    return () => {
      pending.forEach(clearTimeout);
      pending.length = 0;
    };
  }, []);

  const visible = SCRIPT.slice(0, shown);

  return (
    <div className="relative mx-auto w-fit" style={{ perspective: "1400px" }}>
      {/* Ambient bloom. Sits behind the device and outside its rounded clip so
          the colour spills past the silhouette instead of stopping at it. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -inset-16 rounded-full blur-[130px]"
        style={{
          background:
            "radial-gradient(circle at 50% 40%, color-mix(in srgb, var(--theme-accent-purple) 34%, transparent), transparent 70%)",
        }}
      />

      {/* The light pooling under the device. An ellipse rather than a circle:
          a circular glow under a tall object reads as a spotlight aimed at the
          camera; a flattened one reads as the surface it's standing on. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-10 left-1/2 h-24 w-[130%] -translate-x-1/2 rounded-[100%] blur-2xl"
        style={{
          background:
            "radial-gradient(ellipse at center, color-mix(in srgb, var(--theme-accent-purple) 55%, transparent), transparent 68%)",
          opacity: 0.7,
        }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-8 left-1/2 h-12 w-[112%] -translate-x-1/2 rounded-[100%]"
        style={{
          border: "1px solid color-mix(in srgb, var(--theme-accent-from) 60%, transparent)",
          boxShadow: "0 0 34px color-mix(in srgb, var(--theme-accent-from) 45%, transparent)",
        }}
      />

      <div
        data-surface="dark"
        className={`relative w-[80vw] max-w-[320px] rounded-[2.75rem] p-2.5 ${
          reduced ? "" : "phone-tilt"
        }`}
        style={{
          transformStyle: "preserve-3d",
          // The bezel: a metal-ish rim built from a gradient rather than a flat
          // border, so the "edge" catches light on one side like a real chassis.
          background:
            "linear-gradient(150deg, rgba(255, 255, 255, 0.22), rgba(255, 255, 255, 0.04) 42%, rgba(0, 0, 0, 0.5))",
          boxShadow:
            "0 50px 110px rgba(0, 0, 0, 0.6), 0 0 90px color-mix(in srgb, var(--theme-accent-purple) 22%, transparent), inset 0 1px 0 rgba(255, 255, 255, 0.3)",
        }}
      >
        <div
          className="relative overflow-hidden rounded-[2.25rem]"
          style={{ background: "#07040f" }}
        >
          {/* --- Status bar --- */}
          <div className="relative flex items-center justify-between px-6 pb-1 pt-3 text-[10px] font-bold text-white">
            <span>9:41</span>
            {/* Dynamic island. Absolutely positioned so it's optically centred
                on the screen, not centred in whatever space the clock leaves. */}
            <span
              aria-hidden="true"
              className="absolute left-1/2 top-2 h-5 w-20 -translate-x-1/2 rounded-full"
              style={{ background: "#000000" }}
            />
            <span className="flex items-center gap-1 opacity-80">
              <Signal size={11} />
              <Wifi size={11} />
              <BatteryFull size={13} />
            </span>
          </div>

          {/* --- Conversation header --- */}
          <div
            className="flex items-center gap-2.5 px-4 py-3"
            style={{
              borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
              background: "rgba(255, 255, 255, 0.04)",
            }}
          >
            <Image
              src="/ghost.png"
              alt=""
              width={30}
              height={30}
              className="drop-shadow-[0_0_10px_rgba(34,211,238,0.6)]"
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-bold leading-tight text-white">
                Anonymous
              </p>
              <p className="flex items-center gap-1.5 text-[10px]" style={{ color: "#c4b5fd" }}>
                <span className="h-1.5 w-1.5 rounded-full bg-green-400" />
                {typing ? "typing…" : "online"}
              </p>
            </div>
            <MoreVertical size={15} style={{ color: "rgba(255, 255, 255, 0.4)" }} />
          </div>

          {/* --- Thread ---
              Fixed height, not min-height. The column grows as beats land and
              shrinks to nothing on reset; without a fixed box the whole hero
              layout would jolt on every loop. */}
          <div className="flex h-[330px] flex-col justify-end gap-2.5 overflow-hidden px-3.5 py-4">
            <AnimatePresence initial={false}>
              {visible.map((beat, index) => {
                const mine = beat.kind === "out";

                return (
                  <motion.div
                    key={index}
                    layout
                    initial={
                      reduced
                        ? { opacity: 0 }
                        : { opacity: 0, y: 12, scale: 0.94 }
                    }
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, transition: tween.fast }}
                    transition={spring.smooth}
                    className={`relative max-w-[82%] ${mine ? "self-end" : "self-start"}`}
                  >
                    {beat.kind === "photo" ? (
                      <div
                        className="overflow-hidden rounded-2xl rounded-tl-sm"
                        style={{ border: "1px solid rgba(255, 255, 255, 0.1)" }}
                      >
                        {/* A rendered scene, not a stock photo. Whisper ships no
                            photography, and a placeholder image file that has to
                            exist is a dependency this component doesn't need. */}
                        <div
                          className="h-24 w-40"
                          style={{
                            background:
                              "linear-gradient(180deg, #4c1d95 0%, #7e22ce 38%, #db2777 62%, #1e1b4b 100%)",
                          }}
                        >
                          <div
                            className="h-full w-full"
                            style={{
                              background:
                                "radial-gradient(circle at 68% 62%, rgba(255, 214, 170, 0.85), transparent 26%), radial-gradient(ellipse at 50% 108%, rgba(10, 8, 30, 0.9), transparent 60%)",
                            }}
                          />
                        </div>
                      </div>
                    ) : beat.kind === "voice" ? (
                      <div
                        className="flex w-52 items-center gap-2.5 rounded-2xl rounded-tl-sm px-3 py-2.5"
                        style={{ background: BUBBLE_IN }}
                      >
                        <span
                          className="grid h-7 w-7 shrink-0 place-items-center rounded-full"
                          style={{ background: "rgba(255, 255, 255, 0.16)" }}
                        >
                          <Play size={11} fill="#ffffff" style={{ color: "#ffffff" }} />
                        </span>
                        <VoiceBars />
                        <span className="shrink-0 text-[10px] text-white/60">
                          {beat.length}
                        </span>
                      </div>
                    ) : (
                      <div
                        className={`rounded-2xl px-3.5 py-2.5 text-[13px] leading-5 text-white ${
                          mine ? "rounded-br-sm" : "rounded-tl-sm"
                        }`}
                        style={{
                          background: mine ? BUBBLE_OUT : BUBBLE_IN,
                          border: mine
                            ? "1px solid rgba(255, 255, 255, 0.16)"
                            : "1px solid rgba(255, 255, 255, 0.06)",
                        }}
                      >
                        {beat.text}
                        <span className="ml-2 align-baseline text-[9px] text-white/45">
                          {beat.time}
                        </span>
                      </div>
                    )}

                    {"reaction" in beat && beat.reaction && (
                      <Reaction emoji={beat.reaction} />
                    )}
                  </motion.div>
                );
              })}

              {typing && (
                <motion.div
                  key="typing"
                  layout
                  initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9, transition: tween.fast }}
                  transition={spring.snappy}
                  className="flex w-fit items-center gap-1 self-start rounded-2xl rounded-tl-sm px-3.5 py-3"
                  style={{ background: BUBBLE_IN }}
                >
                  {[0, 1, 2].map((dot) => (
                    <motion.span
                      key={dot}
                      className="h-1.5 w-1.5 rounded-full"
                      style={{ background: "#a78bfa" }}
                      animate={reduced ? undefined : { y: [0, -4, 0], opacity: [0.45, 1, 0.45] }}
                      transition={{
                        duration: 0.9,
                        repeat: Infinity,
                        ease: "easeInOut",
                        delay: dot * 0.13,
                      }}
                    />
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* --- Composer --- */}
          <div
            className="flex items-center gap-2 px-3 py-2.5"
            style={{
              borderTop: "1px solid rgba(255, 255, 255, 0.08)",
              background: "rgba(255, 255, 255, 0.04)",
            }}
          >
            <div
              className="flex-1 rounded-full px-3.5 py-2 text-[12px]"
              style={{
                background: "rgba(0, 0, 0, 0.35)",
                color: "rgba(255, 255, 255, 0.4)",
              }}
            >
              Send a message…
            </div>
            <div
              className="grid h-8 w-8 shrink-0 place-items-center rounded-full"
              style={{ background: "linear-gradient(135deg, #22d3ee, #a855f7)" }}
            >
              <Send size={14} style={{ color: "#0b0016" }} />
            </div>
          </div>

          {/* Home indicator. Two pixels of detail that make the frame read as a
              phone rather than as a rounded rectangle with a chat in it. */}
          <div className="flex justify-center pb-2 pt-1">
            <span
              aria-hidden="true"
              className="h-1 w-24 rounded-full"
              style={{ background: "rgba(255, 255, 255, 0.3)" }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
