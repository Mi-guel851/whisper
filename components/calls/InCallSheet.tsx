"use client";

import { useEffect, useState, type ReactNode } from "react";
import { motion } from "framer-motion";
import { Mic, MicOff, PhoneCall, PhoneOff, Volume2, VolumeX } from "lucide-react";

import { formatCallDuration } from "@/lib/calls/callFormat";
import type { CallStatus } from "@/lib/calls/useVoiceCall";
import useSafeReducedMotion from "@/lib/useSafeReducedMotion";
import { spring } from "@/lib/motion";

type InCallSheetProps = {
  name: string;
  avatarUrl: string;
  status: Exclude<CallStatus, "idle" | "incoming">;
  startedAt: number | null;
  muted: boolean;
  speakerSupported: boolean;
  speakerOn: boolean;
  onToggleMute: () => void;
  onToggleSpeaker: () => void;
  onHangUp: () => void;
};

/**
 * WhatsApp-style active call surface.
 *
 * The previous call UI was a compact bottom sheet over the chat. It worked, but
 * it did not feel like a call. This screen takes over the viewport while the
 * call is ringing/connecting/live, keeps the anonymous identity centered, and
 * puts large round mute/speaker/end controls along the bottom — the mental model
 * users already know from WhatsApp/phone calls.
 */
export default function InCallSheet({
  name,
  avatarUrl,
  status,
  startedAt,
  muted,
  speakerSupported,
  speakerOn,
  onToggleMute,
  onToggleSpeaker,
  onHangUp,
}: InCallSheetProps) {
  const reduced = useSafeReducedMotion();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (startedAt === null) return;
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [startedAt]);

  const label =
    status === "in_call"
      ? startedAt !== null
        ? formatCallDuration(now - startedAt)
        : "0:00"
      : status === "outgoing"
        ? "Ringing…"
        : "Connecting…";

  return (
    <motion.div
      className="fixed inset-0 z-[60] flex flex-col overflow-hidden bg-[#07130f] px-6 pb-[max(2rem,env(safe-area-inset-bottom))] pt-[max(3rem,env(safe-area-inset-top))] text-white"
      initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 1.02 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={reduced ? { duration: 0 } : { duration: 0.22, ease: "easeOut" }}
    >
      <div
        className="absolute inset-0 opacity-90"
        style={{
          background:
            "radial-gradient(circle at 50% 22%, rgba(37,211,102,0.30), transparent 30%), radial-gradient(circle at 15% 85%, rgba(34,211,238,0.16), transparent 32%), linear-gradient(180deg, #0b2119 0%, #06100d 62%, #020605 100%)",
        }}
      />
      <div className="absolute inset-0 bg-[linear-gradient(120deg,rgba(255,255,255,0.06)_0_1px,transparent_1px_28px)] opacity-20" />

      <div className="relative z-10 flex flex-1 flex-col items-center justify-between">
        <div className="flex flex-col items-center text-center">
          <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-xs font-bold uppercase tracking-[0.22em] text-white/70">
            <PhoneCall size={13} />
            Whisper voice call
          </div>

          <div className="relative mt-14 flex items-center justify-center">
            {!reduced && status !== "in_call" &&
              [0, 0.9].map((delay) => (
                <motion.span
                  key={delay}
                  className="absolute rounded-full border border-[#25D366]/45"
                  style={{ width: 150, height: 150 }}
                  initial={{ scale: 0.92, opacity: 0.8 }}
                  animate={{ scale: 1.75, opacity: 0 }}
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
          <p className="mt-2 text-base font-semibold tabular-nums text-white/72">{label}</p>
        </div>

        <div className="w-full max-w-sm">
          <div className="mb-6 grid grid-cols-3 items-center justify-items-center gap-4">
            <CallControlButton
              label={muted ? "Unmute" : "Mute"}
              active={muted}
              onClick={onToggleMute}
              reduced={reduced}
            >
              {muted ? <MicOff size={24} /> : <Mic size={24} />}
            </CallControlButton>

            <motion.button
              type="button"
              onClick={onHangUp}
              whileTap={reduced ? undefined : { scale: 0.92, transition: spring.snappy }}
              className="flex h-[4.5rem] w-[4.5rem] items-center justify-center rounded-full bg-[#ef4444] text-white shadow-2xl shadow-red-950/50"
              aria-label="End call"
            >
              <PhoneOff size={28} />
            </motion.button>

            {speakerSupported ? (
              <CallControlButton
                label={speakerOn ? "Speaker" : "Speaker"}
                active={speakerOn}
                onClick={onToggleSpeaker}
                reduced={reduced}
              >
                {speakerOn ? <Volume2 size={24} /> : <VolumeX size={24} />}
              </CallControlButton>
            ) : (
              <div className="flex h-[4.5rem] w-[4.5rem] items-center justify-center rounded-full bg-white/5 text-white/25" aria-hidden>
                <VolumeX size={24} />
              </div>
            )}
          </div>
          <p className="text-center text-xs font-medium leading-relaxed text-white/45">
            Audio is end-to-end over WebRTC. Whisper does not record calls.
          </p>
        </div>
      </div>
    </motion.div>
  );
}

function CallControlButton({
  label,
  active,
  reduced,
  onClick,
  children,
}: {
  label: string;
  active: boolean;
  reduced: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2">
      <motion.button
        type="button"
        onClick={onClick}
        whileTap={reduced ? undefined : { scale: 0.92, transition: spring.snappy }}
        className="flex h-[4.5rem] w-[4.5rem] items-center justify-center rounded-full shadow-xl"
        style={{
          background: active ? "rgba(255,255,255,0.92)" : "rgba(255,255,255,0.14)",
          color: active ? "#07130f" : "#fff",
          border: "1px solid rgba(255,255,255,0.16)",
        }}
        aria-label={label}
        aria-pressed={active}
      >
        {children}
      </motion.button>
      <span className="text-[11px] font-bold text-white/65">{label}</span>
    </div>
  );
}
