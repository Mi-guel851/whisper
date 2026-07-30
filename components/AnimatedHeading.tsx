"use client";

import { motion, AnimatePresence } from "framer-motion";
import { useEffect, useState } from "react";

const text = "Honest conversations start with Whisper.";

export default function AnimatedHeading() {
  const [phase, setPhase] = useState<"typing" | "idle" | "debris">("typing");
  const [key, setKey] = useState(0);

  useEffect(() => {
    if (phase === "typing") {
      const timer = setTimeout(() => setPhase("idle"), text.length * 50 + 2000);
      return () => clearTimeout(timer);
    }
    if (phase === "idle") {
      const timer = setTimeout(() => setPhase("debris"), 3000);
      return () => clearTimeout(timer);
    }
    if (phase === "debris") {
      const timer = setTimeout(() => {
        setKey(prev => prev + 1);
        setPhase("typing");
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, [phase]);

  const characters = text.split("");

  return (
    <div className="relative min-h-[160px] sm:min-h-[220px] flex items-center justify-center overflow-visible">
      <h1 className="max-w-4xl text-4xl font-black leading-[1.15] text-white sm:text-6xl sm:leading-[1.1] md:text-7xl">
        <AnimatePresence mode="popLayout">
          {phase !== "debris" ? (
            <motion.div
              key={`text-${key}`}
              initial="hidden"
              animate="visible"
              exit="exit"
              className="inline-block"
            >
              {characters.map((char, i) => (
                <motion.span
                  key={i}
                  variants={{
                    hidden: { opacity: 0 },
                    visible: { opacity: 1 },
                  }}
                  transition={{
                    duration: 0.05,
                    delay: i * 0.05,
                  }}
                  className={char === " " ? "inline-block w-[0.25em]" : "inline-block"}
                >
                  <span className={i >= text.length - 8 ? "bg-gradient-to-r from-cyan-400 to-purple-600 bg-clip-text text-transparent" : ""}>
                    {char}
                  </span>
                </motion.span>
              ))}
            </motion.div>
          ) : (
            <motion.div
              key={`debris-${key}`}
              className="inline-block"
            >
              {characters.map((char, i) => (
                <motion.span
                  key={i}
                  initial={{ opacity: 1, x: 0, y: 0, rotate: 0, scale: 1 }}
                  animate={{
                    opacity: 0,
                    x: (Math.random() - 0.5) * 600,
                    y: (Math.random() - 0.5) * 600,
                    rotate: (Math.random() - 0.5) * 1000,
                    scale: 0,
                  }}
                  transition={{
                    duration: 1.5,
                    ease: [0.22, 1, 0.36, 1], // Custom ease for "debris" feel
                  }}
                  className={char === " " ? "inline-block w-[0.25em]" : "inline-block"}
                >
                  <span className={i >= text.length - 8 ? "bg-gradient-to-r from-cyan-400 to-purple-600 bg-clip-text text-transparent" : ""}>
                    {char}
                  </span>
                </motion.span>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </h1>
    </div>
  );
}