"use client";

import { Fragment } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { ease } from "@/lib/motion";

const LEAD = "Honest conversations start with ";
const ACCENT = "Whisper.";

export default function AnimatedHeading() {
  const reduced = useReducedMotion();
  let charIndex = -1;
  const words = [
    ...LEAD.trimEnd().split(" ").map((word) => ({ word, accent: false })),
    { word: ACCENT, accent: true },
  ];

  return (
    <h1 className="display-title mx-auto max-w-4xl text-white">
      {words.map(({ word, accent }, wordIdx) => (
        <Fragment key={`${word}-${wordIdx}`}>
          <span
            // inline-block keeps a word from breaking mid-cascade across lines.
            className="inline-block whitespace-nowrap"
          >
            {[...word].map((char) => {
              charIndex += 1;
              return (
                <motion.span
                  key={charIndex}
                  className={`inline-block ${accent ? "theme-accent-text" : ""}`}
                  initial={
                    reduced
                      ? { opacity: 0 }
                      : { opacity: 0, filter: "blur(8px)" }
                  }
                  animate={{ opacity: 1, filter: "blur(0px)" }}
                  transition={{
                    duration: reduced ? 0.2 : 0.34,
                    delay: reduced ? 0 : charIndex * 0.016,
                    ease: ease.outQuint,
                  }}
                >
                  {char}
                </motion.span>
              );
            })}
          </span>
          {/* A real space, outside the animated spans and outside the nowrap
              wrapper, so the browser can still break the line here. */}
          {wordIdx < words.length - 1 && " "}
        </Fragment>
      ))}
    </h1>
  );
}
