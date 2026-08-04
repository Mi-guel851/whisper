"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Mic, Send } from "lucide-react";
import Image from "next/image";
import { spring, tween } from "@/lib/motion";
import { useSafeReducedMotion } from "@/lib/useSafeReducedMotion";

const SCRIPT = [
  "you don't know it but... you inspire me every day 💫",
  "your laugh is my favorite sound",
  "ngl you're better looking than you think 👀",
];

const TYPING_MS = 1300;
const READ_MS = 1600;
const RESET_MS = 3200;

/**
 * Marketing mockup: an anonymous conversation playing out on a phone.
 *
 * The loop is intentional. Emil's frequency rule says to strip animation from
 * things users see constantly — but this *is* the explanation of the product,
 * seen once on the landing page, so looping is what makes it legible.
 *
 * Note `data-surface="dark"`: the phone screen renders the dark app UI in both
 * themes. Without the opt-out, the light-theme compatibility bridge in
 * globals.css would repaint `text-white` to near-black and the screen would go
 * blank.
 */
export default function PhoneMockup() {
  const [visible, setVisible] = useState<string[]>([]);
  const [typing, setTyping] = useState(false);
  const timeouts = useRef<ReturnType<typeof setTimeout>[]>([]);
  const reduced = useSafeReducedMotion();

  useEffect(() => {
    // Captured for the cleanup closure: reading `timeouts.current` there would
    // read whatever the ref points at when the effect tears down, not the array
    // this run scheduled into.
    const pending = timeouts.current;

    function schedule(fn: () => void, delay: number) {
      pending.push(setTimeout(fn, delay));
    }

    let index = 0;

    function showNext() {
      if (index >= SCRIPT.length) {
        schedule(() => {
          setVisible([]);
          index = 0;
          showNext();
        }, RESET_MS);
        return;
      }

      setTyping(true);
      schedule(() => {
        setTyping(false);
        setVisible((prev) => [...prev, SCRIPT[index]]);
        index += 1;
        schedule(showNext, READ_MS);
      }, TYPING_MS);
    }

    showNext();

    return () => {
      pending.forEach(clearTimeout);
      pending.length = 0;
    };
  }, []);

  return (
    <div className="relative mx-auto w-fit" style={{ perspective: "1200px" }}>
      {/* Ambient bloom behind the device. */}
      <div
        aria-hidden="true"
        className="absolute -inset-12 rounded-full blur-[120px]"
        style={{
          background:
            "color-mix(in srgb, var(--theme-accent-purple) 22%, transparent)",
        }}
      />

      <div
        data-surface="dark"
        className={`relative w-[85vw] max-w-[340px] overflow-hidden rounded-[36px] ${
          reduced ? "" : "phone-tilt"
        }`}
        style={{
          transformStyle: "preserve-3d",
          background: "rgba(11, 0, 22, 0.55)",
          backdropFilter: "blur(40px) saturate(180%)",
          WebkitBackdropFilter: "blur(40px) saturate(180%)",
          border: "1px solid rgba(255, 255, 255, 0.1)",
          boxShadow:
            "0 40px 90px rgba(0, 0, 0, 0.45), 0 0 80px rgba(34, 211, 238, 0.1)",
        }}
      >
        <div
          className="flex items-center gap-3 px-5 py-4"
          style={{
            borderBottom: "1px solid rgba(255, 255, 255, 0.1)",
            background: "rgba(255, 255, 255, 0.05)",
          }}
        >
          <Image
            src="/ghost.png"
            alt=""
            width={36}
            height={36}
            className="drop-shadow-[0_0_10px_rgba(34,211,238,0.65)]"
          />
          <div>
            <p className="font-bold leading-tight text-white">anonymous</p>
            <p
              className="flex items-center gap-1.5 text-xs"
              style={{ color: "#c4b5fd" }}
            >
              <span className="h-1.5 w-1.5 rounded-full bg-green-400" />
              whispering to @you
            </p>
          </div>
        </div>

        <div className="flex min-h-[280px] flex-col justify-end gap-3 px-5 py-6">
          {/* `layout` on the bubbles so the stack slides up as each one lands,
              instead of the whole column snapping to its new height. */}
          <AnimatePresence initial={false}>
            {visible.map((message, index) => (
              <motion.div
                key={`${index}-${message}`}
                layout
                initial={reduced ? { opacity: 0 } : { opacity: 0, y: 10, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, transition: tween.fast }}
                transition={spring.smooth}
                className="max-w-[85%] self-start rounded-2xl rounded-tl-sm px-4 py-3 text-sm text-white"
                style={{ background: "rgba(255, 255, 255, 0.1)" }}
              >
                {message}
              </motion.div>
            ))}

            {typing && (
              <motion.div
                key="typing"
                layout
                initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9, transition: tween.fast }}
                transition={spring.snappy}
                className="flex w-fit items-center gap-1 self-start rounded-2xl rounded-tl-sm px-4 py-3"
                style={{ background: "rgba(255, 255, 255, 0.1)" }}
              >
                {[0, 1, 2].map((dot) => (
                  <motion.span
                    key={dot}
                    className="h-2 w-2 rounded-full"
                    style={{ background: "#a78bfa" }}
                    animate={reduced ? undefined : { y: [0, -4, 0], opacity: [0.5, 1, 0.5] }}
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

        <div
          className="flex items-center gap-3 px-4 py-3"
          style={{
            borderTop: "1px solid rgba(255, 255, 255, 0.1)",
            background: "rgba(255, 255, 255, 0.05)",
          }}
        >
          <div
            className="flex-1 rounded-full px-4 py-2.5 text-sm"
            style={{
              background: "rgba(0, 0, 0, 0.3)",
              color: "rgba(255, 255, 255, 0.45)",
            }}
          >
            send a whisper...
          </div>
          <Mic size={18} style={{ color: "rgba(255, 255, 255, 0.45)" }} />
          <div
            className="grid h-9 w-9 place-items-center rounded-full"
            style={{
              background: "linear-gradient(135deg, #22d3ee, #a855f7)",
            }}
          >
            <Send size={16} style={{ color: "#0b0016" }} />
          </div>
        </div>
      </div>
    </div>
  );
}
