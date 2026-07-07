"use client";

import { useState } from "react";
import {
  MessageCircle,
  ImageIcon,
  Zap,
  Shield,
  Link2,
  BarChart3,
  type LucideIcon,
} from "lucide-react";
import GlassPanel from "./GlassPanel";

const features = [
  { icon: MessageCircle, title: "Anonymous Messages", desc: "Receive honest, unfiltered messages from anyone — they'll never know it was them." },
  { icon: ImageIcon, title: "Anonymous Images", desc: "Let people send images alongside their messages, completely anonymously." },
  { icon: Zap, title: "Real-Time Inbox", desc: "Watch messages and views land live, no refresh needed — instant notifications." },
  { icon: Shield, title: "100% Anonymous", desc: "No sender identity is ever stored or shown. Not to you, not to anyone." },
  { icon: Link2, title: "One Shareable Link", desc: "Get your own Whisper link and drop it anywhere — bio, stories, DMs." },
  { icon: BarChart3, title: "Live Analytics", desc: "Track messages and views over time with your own activity chart." },
];

function TiltCard({ icon: Icon, title, desc }: { icon: LucideIcon; title: string; desc: string }) {
  const [tilt, setTilt] = useState({ x: 0, y: 0 });

  function handleMove(e: React.MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width - 0.5;
    const py = (e.clientY - rect.top) / rect.height - 0.5;
    setTilt({ x: py * -12, y: px * 12 });
  }

  function handleLeave() {
    setTilt({ x: 0, y: 0 });
  }

  return (
    <div
      onMouseMove={handleMove}
      onMouseLeave={handleLeave}
      style={{ transform: `perspective(800px) rotateX(${tilt.x}deg) rotateY(${tilt.y}deg)` }}
      className="transition-transform duration-200 ease-out"
    >
      <GlassPanel className="rounded-3xl p-8 h-full transition-colors hover:bg-white/[0.08]">
        <div className="mb-5 inline-flex rounded-2xl bg-cyan-500/10 p-3">
          <Icon className="text-cyan-300" size={26} />
        </div>
        <h3 className="mb-2 text-xl font-bold text-white">{title}</h3>
        <p className="text-gray-400 leading-7">{desc}</p>
      </GlassPanel>
    </div>
  );
}

export default function Features() {
  return (
    <section id="features" className="relative mx-auto max-w-7xl px-8 py-24">
      <div className="mb-16 text-center">
        <h2 className="text-5xl font-black text-white">
          Everything you need,
          <span className="block bg-gradient-to-r from-cyan-400 via-purple-400 to-pink-400 bg-clip-text text-transparent">
            nothing you don&apos;t.
          </span>
        </h2>
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
        {features.map((f) => (
          <TiltCard key={f.title} {...f} />
        ))}
      </div>
    </section>
  );
}
