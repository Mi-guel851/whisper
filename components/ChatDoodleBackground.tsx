"use client";

import { motion } from "framer-motion";

const stickers = [
  { emoji: "💬", left: "8%",  top: "12%", size: 46, duration: 18, delay: 0,   rotate: -10 },
  { emoji: "✨", left: "74%", top: "18%", size: 34, duration: 16, delay: 1.2, rotate: 8   },
  { emoji: "💙", left: "20%", top: "70%", size: 40, duration: 20, delay: 2.4, rotate: -8  },
  { emoji: "🫶", left: "82%", top: "68%", size: 42, duration: 17, delay: 0.8, rotate: 10  },
  { emoji: "🌈", left: "50%", top: "24%", size: 32, duration: 19, delay: 3.1, rotate: 4   },
  { emoji: "👻", left: "35%", top: "50%", size: 38, duration: 22, delay: 1.8, rotate: -6  },
  { emoji: "🔮", left: "62%", top: "80%", size: 36, duration: 15, delay: 2.9, rotate: 12  },
];

export default function ChatDoodleBackground() {
  return (
    <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.08),transparent_35%),radial-gradient(circle_at_bottom_right,rgba(34,211,238,0.08),transparent_30%)]" />
      <div className="absolute inset-0" style={{ opacity: 0.35 }}>
        {stickers.map((sticker, index) => (
          <motion.div
            key={`${sticker.emoji}-${index}`}
            className="absolute select-none"
            style={{
              left: sticker.left,
              top: sticker.top,
              fontSize: sticker.size,
              filter: "drop-shadow(0 4px 8px rgba(0,0,0,0.12))",
            }}
            initial={{ opacity: 0.5, scale: 0.9, rotate: sticker.rotate, y: 0, x: 0 }}
            animate={{
              opacity: [0.5, 0.75, 0.55, 0.8, 0.5],
              scale: [0.9, 1.04, 0.95, 1.08, 0.9],
              rotate: [sticker.rotate, sticker.rotate + 4, sticker.rotate, sticker.rotate - 4, sticker.rotate],
              y: [0, -14, 0, 12, 0],
              x: [0, 8, -5, 6, 0],
            }}
            transition={{
              duration: sticker.duration,
              repeat: Infinity,
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