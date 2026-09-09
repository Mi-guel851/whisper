"use client";

import Image from "next/image";
import { motion } from "framer-motion";
import { Bell, EyeOff, Link2, MessageCircle, ShieldCheck } from "lucide-react";

import useSafeReducedMotion from "@/lib/useSafeReducedMotion";

export default function WhisperPhoneMockup({ username }: { username: string }) {
  const reduced = useSafeReducedMotion();

  return (
    <div className="dashboard-phone-stage" aria-label="Illustration of the private Whisper inbox">
      <div className="dashboard-phone-orbit dashboard-phone-orbit-one" aria-hidden />
      <div className="dashboard-phone-orbit dashboard-phone-orbit-two" aria-hidden />

      <motion.div
        className="dashboard-phone"
        initial={reduced ? false : { opacity: 0, y: 16, rotate: 1 }}
        animate={{ opacity: 1, y: 0, rotate: 4 }}
        transition={{ duration: reduced ? 0 : 0.72, ease: [0.16, 1, 0.3, 1] }}
      >
        <div className="dashboard-phone-screen">
          <div className="dashboard-phone-status"><span>9:41</span><span>● ● ◒</span></div>
          <div className="dashboard-phone-head">
            <span className="dashboard-phone-logo"><Image src="/ghost.png" alt="" width={18} height={18} /></span>
            <span><strong>Whisper</strong><small>@{username}</small></span>
            <Bell size={13} />
          </div>
          <div className="dashboard-phone-label">Your private inbox</div>
          <div className="dashboard-phone-bubble is-incoming">
            <span className="dashboard-phone-ghost"><Image src="/ghost.png" alt="" width={15} height={15} /></span>
            <p>Your anonymous messages live here.</p>
            <small>Sender identities stay private</small>
          </div>
          <div className="dashboard-phone-bubble is-reply">
            <p>Reply when you&apos;re ready.</p>
            <small>One-to-one conversation</small>
          </div>
          <div className="dashboard-phone-compose">
            <span>Private reply</span><MessageCircle size={14} />
          </div>
        </div>
      </motion.div>

      <div className="dashboard-float-chip dashboard-float-message" aria-hidden>
        <ShieldCheck size={15} /><span><strong>Anonymous by design</strong><small>privacy protected</small></span>
      </div>
      <div className="dashboard-float-chip dashboard-float-heart" aria-hidden>
        <EyeOff size={16} /><strong>No names</strong>
      </div>
      <div className="dashboard-float-chip dashboard-float-link" aria-hidden>
        <Link2 size={14} /><span className="truncate">whisper.app/u/{username}</span>
      </div>
    </div>
  );
}
