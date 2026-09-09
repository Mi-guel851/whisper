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

/**
 * The incoming-call overlay.
 *
 * Full-screen on purpose, and deliberately the most "phone" surface in the
 * app: one person, two buttons, no escape hatch that isn't an answer. The
 * ring vibration and tone are driven by the hook (they must start the moment
 * the signal lands, not when React finishes mounting this component), so this
 * component is purely the face of the call.
 *
 * z-[70]: above the in-call sheet and every in-app modal, because a call
 * arriving over an open pin-duration dialog must win that screen.
 */
export default function IncomingCallOverlay({ name, avatarUrl, onAccept, onDecline }: IncomingCallOverlayProps) {
  const reduced = useSafeReducedMotion();

  return (
    <motion.div
      className="fixed inset-0 z-[70] flex flex-col items-center justify-center bg-black/80 px-6"
      style={{ backdropFilter: "blur(18px)", WebkitBackdropFilter: "blur(18px)" }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={reduced ? { duration: 0 } : { duration: 0.25 }}
    >
      <div className="relative flex items-center justify-center">
        {/* The ring: two pulses behind the avatar, expanding and fading —
            the visual half of the ring tone. */}
        {!reduced &&
          [0, 0.9].map((delay) => (
            <motion.span
              key={delay}
              className="absolute rounded-full"
              style={{
                width: 120,
                height: 120,
                border: "2px solid rgba(34, 211, 238, 0.5)",
              }}
              initial={{ scale: 1, opacity: 0.7 }}
              animate={{ scale: 1.9, opacity: 0 }}
              transition={{
                duration: 1.8,
                delay,
                repeat: Infinity,
                ease: "easeOut",
              }}
            />
          ))}

        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={avatarUrl}
          alt=""
          className="h-28 w-28 rounded-full object-cover"
          style={{ border: "3px solid rgba(34, 211, 238, 0.6)", background: "var(--fill-2)" }}
        />
      </div>

      <h1 className="mt-7 text-2xl font-black text-white">{name}</h1>
      <p className="mt-1.5 text-sm font-medium text-white/70">Voice call incoming…</p>

      <div className="mt-12 flex w-full max-w-xs items-center justify-between px-2">
        <motion.button
          type="button"
          onClick={onDecline}
          whileTap={reduced ? undefined : { scale: 0.92 }}
          className="flex h-16 w-16 flex-col items-center justify-center gap-1 rounded-full bg-rose-500/90 text-white shadow-xl"
          aria-label="Decline call"
        >
          <PhoneOff size={22} />
          <span className="text-[10px] font-bold">Decline</span>
        </motion.button>

        <motion.button
          type="button"
          onClick={onAccept}
          /* The accept button breathes until the tap: a call you can't see
             pulsing is a call you might miss, and the pulse is the "pick up"
             affordance phones have had for fifty years. */
          animate={reduced ? undefined : { scale: [1, 1.06, 1] }}
          transition={reduced ? { duration: 0 } : { duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
          whileTap={reduced ? undefined : { scale: 0.92 }}
          className="flex h-16 w-16 flex-col items-center justify-center gap-1 rounded-full text-white shadow-xl"
          style={{
            background: "linear-gradient(135deg, #22d3ee, #a855f7)",
          }}
          aria-label="Accept call"
        >
          <motion.span
            animate={reduced ? undefined : { rotate: [0, -14, 14, 0] }}
            transition={reduced ? { duration: 0 } : { duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
          >
            <Phone size={22} />
          </motion.span>
          <span className="text-[10px] font-bold">Accept</span>
        </motion.button>
      </div>

    </motion.div>
  );
}
