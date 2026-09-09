"use client";

import { motion } from "framer-motion";
import { Phone, PhoneOff } from "lucide-react";

import useSafeReducedMotion from "@/lib/useSafeReducedMotion";

type IncomingCallOverlayProps = {
  name: string;
  avatarUrl: string;
  onAccept: () => void;
  onDecline: () => void;
};

/** WhatsApp-style incoming-call screen: full-screen, green accept, red decline. */
export default function IncomingCallOverlay({ name, avatarUrl, onAccept, onDecline }: IncomingCallOverlayProps) {
  const reduced = useSafeReducedMotion();

  return (
    <motion.div
      className="fixed inset-0 z-[70] flex flex-col overflow-hidden bg-[#07130f] px-6 pb-[max(2rem,env(safe-area-inset-bottom))] pt-[max(3rem,env(safe-area-inset-top))] text-white"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={reduced ? { duration: 0 } : { duration: 0.25 }}
    >
      <div
        className="absolute inset-0 opacity-95"
        style={{
          background:
            "radial-gradient(circle at 50% 22%, rgba(37,211,102,0.32), transparent 31%), radial-gradient(circle at 86% 90%, rgba(34,211,238,0.12), transparent 30%), linear-gradient(180deg, #0b2119 0%, #06100d 62%, #020605 100%)",
        }}
      />
      <div className="absolute inset-0 bg-[linear-gradient(120deg,rgba(255,255,255,0.06)_0_1px,transparent_1px_28px)] opacity-20" />

      <div className="relative z-10 flex flex-1 flex-col items-center justify-between text-center">
        <div className="flex flex-col items-center">
          <div className="inline-flex items-center rounded-full bg-white/10 px-3 py-1.5 text-xs font-bold uppercase tracking-[0.22em] text-white/70">
            Incoming voice call
          </div>

          <div className="relative mt-16 flex items-center justify-center">
            {!reduced &&
              [0, 0.9].map((delay) => (
                <motion.span
                  key={delay}
                  className="absolute rounded-full border border-[#25D366]/45"
                  style={{ width: 156, height: 156 }}
                  initial={{ scale: 0.92, opacity: 0.8 }}
                  animate={{ scale: 1.85, opacity: 0 }}
                  transition={{ duration: 1.8, delay, repeat: Infinity, ease: "easeOut" }}
                />
              ))}

            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={avatarUrl}
              alt=""
              className="h-36 w-36 rounded-full object-cover shadow-2xl"
              style={{ border: "4px solid rgba(37, 211, 102, 0.62)", background: "var(--fill-2)" }}
            />
          </div>

          <h1 className="mt-8 max-w-xs truncate text-3xl font-black text-white">{name}</h1>
          <p className="mt-2 text-base font-semibold text-white/72">Whisper voice call…</p>
        </div>

        <div className="w-full max-w-xs">
          <div className="flex items-center justify-between px-2">
            <div className="flex flex-col items-center gap-2">
              <motion.button
                type="button"
                onClick={onDecline}
                whileTap={reduced ? undefined : { scale: 0.92 }}
                className="flex h-[4.5rem] w-[4.5rem] items-center justify-center rounded-full bg-[#ef4444] text-white shadow-2xl shadow-red-950/50"
                aria-label="Decline call"
              >
                <PhoneOff size={28} />
              </motion.button>
              <span className="text-[11px] font-bold text-white/65">Decline</span>
            </div>

            <div className="flex flex-col items-center gap-2">
              <motion.button
                type="button"
                onClick={onAccept}
                animate={reduced ? undefined : { scale: [1, 1.06, 1] }}
                transition={reduced ? { duration: 0 } : { duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
                whileTap={reduced ? undefined : { scale: 0.92 }}
                className="flex h-[4.5rem] w-[4.5rem] items-center justify-center rounded-full bg-[#25D366] text-white shadow-2xl shadow-emerald-950/50"
                aria-label="Accept call"
              >
                <motion.span
                  animate={reduced ? undefined : { rotate: [0, -14, 14, 0] }}
                  transition={reduced ? { duration: 0 } : { duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
                >
                  <Phone size={28} />
                </motion.span>
              </motion.button>
              <span className="text-[11px] font-bold text-white/65">Accept</span>
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
