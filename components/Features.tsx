"use client";

import { motion } from "framer-motion";
import {
  MessageCircle,
  Lock,
  Zap,
  AudioLines,
  Sparkles,
  BarChart3,
  Heart,
} from "lucide-react";
import type { ReactNode } from "react";
import SectionHeading from "./home/SectionHeading";
import BentoCard from "./home/BentoCard";
import { Waveform, Sparkline, BarChart } from "./home/MiniViz";
import { respectMotion, staggerContainer } from "@/lib/motion";
import { useSafeReducedMotion } from "@/lib/useSafeReducedMotion";

/**
 * The feature bento.
 *
 * This replaced a uniform 3×2 grid of identical cards. A grid where every tile
 * is the same size and the same shape gives the eye nothing to prioritise, so
 * six equally-weighted features read as one undifferentiated block — the
 * classic template look. Unequal tiles let the layout say which capabilities
 * matter, and let a feature be *shown* (a waveform, a trend line, a live
 * conversation) instead of only described.
 *
 * Spans are on a 12-column `lg` grid, 6 columns at `sm`, one at mobile. Every
 * tile declares `sm:col-span-3` in `BentoCard` so the two-up layout is the
 * default and only the desktop widths vary.
 */

/* -------------------------------------------------------------------------- */

/** Shared header for a tile: plate, title, copy. Module scope — see below. */
function TileHead({
  icon,
  title,
  children,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <>
      <span className="bento-icon mb-4">{icon}</span>
      <h3
        className="mb-2 text-lg font-bold"
        style={{ color: "var(--bridge-text)", letterSpacing: "var(--tracking-lg)" }}
      >
        {title}
      </h3>
      <p
        className="text-sm leading-6"
        style={{ color: "var(--bridge-text-secondary)" }}
      >
        {children}
      </p>
    </>
  );
}

/**
 * The live-conversation tile.
 *
 * Declared at module scope, like every helper in this file. A component defined
 * inside `Features()` would be a brand-new type on each render, so React would
 * unmount and remount the subtree — restarting these entrance animations every
 * time anything above them changed.
 */
function ConversationTile() {
  const reduced = useSafeReducedMotion();

  return (
    <BentoCard span="lg:col-span-3">
      <div className="mb-4 flex items-center gap-2">
        <span
          className="grid h-6 w-6 place-items-center rounded-full text-[11px]"
          style={{
            background: "linear-gradient(135deg, var(--theme-accent-from), var(--theme-accent-to))",
          }}
        >
          👻
        </span>
        <div className="min-w-0">
          <p
            className="truncate text-[11px] font-bold leading-none"
            style={{ color: "var(--bridge-text)" }}
          >
            Anonymous
          </p>
          <p className="text-[10px]" style={{ color: "var(--bridge-text-muted)" }}>
            typing…
          </p>
        </div>
      </div>

      <div className="mt-auto space-y-2">
        <div
          className="w-fit max-w-full rounded-2xl rounded-tl-sm px-3 py-2 text-[13px] leading-5"
          style={{ background: "var(--fill-2)", color: "var(--bridge-text)" }}
        >
          You inspire me daily.
        </div>

        <div className="flex items-center justify-between">
          <span className="text-[10px]" style={{ color: "var(--bridge-text-muted)" }}>
            Seen 9:41 PM
          </span>
          {/* The one looping animation in the bento. It's the beat the tile is
              about — a reaction arriving — and it's a compositor-only scale. */}
          <motion.span
            animate={reduced ? undefined : { scale: [1, 1.16, 1] }}
            transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
            style={{ color: "var(--theme-accent-pink)" }}
          >
            <Heart size={18} fill="currentColor" />
          </motion.span>
        </div>
      </div>
    </BentoCard>
  );
}

/* -------------------------------------------------------------------------- */

export default function Features() {
  const reduced = useSafeReducedMotion();

  return (
    <section
      id="features"
      className="relative mx-auto max-w-7xl px-4 py-16 sm:px-8 sm:py-24"
    >
      <SectionHeading
        eyebrow="Everything included"
        title="Everything you need,"
        accent="nothing you don't."
        description="Text, photos, voice notes and reactions — all anonymous, all in real time, all free."
      />

      <motion.div
        className="grid grid-cols-1 gap-4 sm:grid-cols-6 lg:grid-cols-12"
        variants={respectMotion(staggerContainer(0.055), reduced)}
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, amount: 0.15, margin: "0px 0px -60px 0px" }}
      >
        {/* --- Row one --- */}

        <BentoCard span="lg:col-span-3">
          <TileHead icon={<MessageCircle size={19} />} title="Anonymous Messaging">
            Honest messages from the people who actually know you. They&apos;ll
            never know it was them.
          </TileHead>
        </BentoCard>

        <ConversationTile />

        <BentoCard span="lg:col-span-3">
          <TileHead icon={<Lock size={19} />} title="Anonymous Images">
            Let people send photos alongside their message — sender identity is
            never stored.
          </TileHead>

          {/* A rendered scene rather than a stock photo: no asset to ship, and
              it retints with the accent tokens instead of clashing in light
              theme the way a fixed image would. */}
          <div
            className="relative mt-5 h-24 overflow-hidden rounded-xl"
            style={{
              background:
                "linear-gradient(180deg, #1e1b4b 0%, #6d28d9 45%, #db2777 78%, #0f0a24 100%)",
            }}
          >
            <div
              className="absolute inset-0"
              style={{
                background:
                  "radial-gradient(circle at 72% 68%, rgba(255, 216, 170, 0.75), transparent 24%)",
              }}
            />
            <span className="absolute inset-0 grid place-items-center">
              <span
                className="grid h-9 w-9 place-items-center rounded-full"
                style={{
                  background: "rgba(10, 6, 22, 0.6)",
                  border: "1px solid rgba(255, 255, 255, 0.28)",
                  backdropFilter: "blur(8px)",
                  WebkitBackdropFilter: "blur(8px)",
                }}
              >
                <Lock size={15} style={{ color: "#ffffff" }} />
              </span>
            </span>
          </div>
        </BentoCard>

        <BentoCard span="lg:col-span-3">
          <div className="mb-4 flex items-start justify-between">
            <span className="bento-icon">
              <Zap size={19} />
            </span>
            <span
              className="grid h-6 min-w-6 place-items-center rounded-full px-1.5 text-[11px] font-black"
              style={{ background: "var(--theme-error)", color: "#ffffff" }}
            >
              12
            </span>
          </div>
          <h3
            className="mb-2 text-lg font-bold"
            style={{ color: "var(--bridge-text)", letterSpacing: "var(--tracking-lg)" }}
          >
            Real-Time Inbox
          </h3>
          <p className="text-sm leading-6" style={{ color: "var(--bridge-text-secondary)" }}>
            Messages land live. No refresh, no polling, no waiting.
          </p>
        </BentoCard>

        {/* --- Row two --- */}

        <BentoCard span="lg:col-span-3">
          <TileHead icon={<AudioLines size={19} />} title="Voice Messages">
            Hear what they can&apos;t put into words.
          </TileHead>
          <div className="mt-auto flex items-center gap-3 pt-5">
            <Waveform className="flex-1" />
            <span
              className="shrink-0 text-xs font-bold"
              style={{ color: "var(--bridge-text-muted)" }}
            >
              0:15
            </span>
          </div>
        </BentoCard>

        <BentoCard span="lg:col-span-3">
          <TileHead icon={<Heart size={19} />} title="Reactions">
            React with an emoji and share the vibe back.
          </TileHead>
          <div className="mt-auto flex items-center gap-2 pt-5 text-2xl">
            {["😍", "🔥", "💜", "🎉"].map((emoji, index) => (
              <motion.span
                key={emoji}
                initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.4 }}
                whileInView={{ opacity: 1, scale: 1 }}
                viewport={{ once: true, amount: 0.6 }}
                transition={{
                  type: "spring",
                  stiffness: 480,
                  damping: 17,
                  delay: reduced ? 0 : index * 0.07,
                }}
              >
                {emoji}
              </motion.span>
            ))}
          </div>
        </BentoCard>

        <BentoCard span="lg:col-span-3">
          <TileHead icon={<Sparkles size={19} />} title="AI Insights">
            Understand your audience better.
          </TileHead>
          <div className="mt-auto pt-5">
            <Sparkline />
          </div>
        </BentoCard>

        <BentoCard span="lg:col-span-3">
          <div className="mb-4 flex items-start justify-between">
            <span className="bento-icon">
              <BarChart3 size={19} />
            </span>
            <span
              className="rounded-full px-2 py-0.5 text-[11px] font-black"
              style={{
                color: "var(--theme-success)",
                background: "color-mix(in srgb, var(--theme-success) 14%, transparent)",
              }}
            >
              +2.4K
            </span>
          </div>
          <h3
            className="mb-2 text-lg font-bold"
            style={{ color: "var(--bridge-text)", letterSpacing: "var(--tracking-lg)" }}
          >
            Live Analytics
          </h3>
          <p className="text-sm leading-6" style={{ color: "var(--bridge-text-secondary)" }}>
            Track views, clicks and engagement as they happen.
          </p>
          <div className="mt-auto pt-5">
            <BarChart />
          </div>
        </BentoCard>
      </motion.div>
    </section>
  );
}
