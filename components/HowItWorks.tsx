// HowItWorks.tsx
"use client";

import GlassPanel from "./GlassPanel";

const steps = [
  {
    number: "01",
    title: "Create your link",
    desc: "Sign up in seconds and get your own unique Whisper link instantly.",
  },
  {
    number: "02",
    title: "Share it anywhere",
    desc: "Drop it in your Instagram bio, TikTok, Snapchat story, wherever your audience is.",
  },
  {
    number: "03",
    title: "Receive honest messages",
    desc: "Watch anonymous messages and images roll into your inbox in real time.",
  },
];

export default function HowItWorks() {
  return (
    <section id="how-it-works" className="relative mx-auto max-w-7xl px-4 py-16 sm:px-8 sm:py-24">
      <div className="mb-10 text-center sm:mb-16">
        <h2 className="text-3xl font-black text-white sm:text-5xl">How it works</h2>
        <p className="mt-4 text-base text-gray-400 sm:text-xl">Three steps. Zero identity.</p>
      </div>

      <div className="grid grid-cols-1 gap-6 sm:gap-8 md:grid-cols-3">
        {steps.map((step) => (
          <GlassPanel key={step.number} className="relative rounded-3xl p-6 sm:p-8">
            <div className="mb-6 bg-gradient-to-r from-cyan-400 to-purple-500 bg-clip-text text-5xl font-black text-transparent sm:text-6xl">
              {step.number}
            </div>
            <h3 className="mb-3 text-2xl font-bold text-white">{step.title}</h3>
            <p className="text-gray-400 leading-7">{step.desc}</p>
          </GlassPanel>
        ))}
      </div>

    </section>
  );
}