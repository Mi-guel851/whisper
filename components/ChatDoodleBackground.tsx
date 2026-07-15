"use client";

import { motion } from "framer-motion";

const stickers = [
  { emoji: "💬", left: "8%", top: "12%", size: 46, duration: 18, delay: 0, rotate: -10 },
  { emoji: "✨", left: "74%", top: "18%", size: 34, duration: 16, delay: 1.2, rotate: 8 },
  { emoji: "💙", left: "20%", top: "70%", size: 40, duration: 20, delay: 2.4, rotate: -8 },
  { emoji: "🫶", left: "82%", top: "68%", size: 42, duration: 17, delay: 0.8, rotate: 10 },
  { emoji: "🌈", left: "50%", top: "24%", size: 32, duration: 19, delay: 3.1, rotate: 4 },
];

export default function ChatDoodleBackground() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.12),transparent_35%),radial-gradient(circle_at_bottom_right,rgba(34,211,238,0.12),transparent_30%)]" />
      <div className="absolute inset-0 opacity-[0.16]">
        {stickers.map((sticker, index) => (
          <motion.div
            key={`${sticker.emoji}-${index}`}
            className="absolute select-none"
            style={{
              left: sticker.left,
              top: sticker.top,
              fontSize: sticker.size,
              filter: "drop-shadow(0 8px 18px rgba(0,0,0,0.18))",
            }}
            initial={{ opacity: 0.24, scale: 0.9, rotate: sticker.rotate, y: 0, x: 0 }}
            animate={{
              opacity: [0.24, 0.42, 0.28, 0.46, 0.24],
              scale: [0.9, 1.03, 0.95, 1.08, 0.9],
              rotate: [sticker.rotate, sticker.rotate + 4, sticker.rotate, sticker.rotate - 4, sticker.rotate],
              y: [0, -14, 0, 12, 0],
              x: [0, 8, -5, 6, 0],
            }}
            transition={{
              duration: sticker.duration,
              repeat: Number.POSITIVE_INFINITY,
              repeatType: "mirror",
              ease: "easeInOut",
              delay: sticker.delay,
            }}
          >
            {sticker.emoji}
          </motion.div>
        ))}
      </div>
    </div>
  );
}