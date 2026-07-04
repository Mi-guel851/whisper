// app/components/ClosingCTA.tsx
"use client";

import Link from "next/link";
import Image from "next/image";
import GlassPanel from "./GlassPanel";

export default function ClosingCTA() {
  return (
    <section className="relative mx-auto max-w-5xl px-8 py-24 text-center">
      <GlassPanel strong className="rounded-[40px] p-16">

        <Image
          src="/ghost.png"
          alt="Whisper"
          width={64}
          height={64}
          className="mx-auto mb-6 animate-pulse drop-shadow-[0_0_18px_rgba(34,211,238,.9)]"
        />

        <h2 className="text-5xl font-black text-white">
          Ready to hear the truth?
        </h2>

        <p className="mx-auto mt-4 max-w-xl text-xl text-gray-300">
          Create your Whisper link and start receiving honest, anonymous messages today.
        </p>

        <Link
          href="/signup"
          className="mt-10 inline-block rounded-2xl bg-gradient-to-r from-cyan-500 to-purple-600 px-10 py-5 text-lg font-bold text-white transition hover:scale-105"
        >
          Create My Link — It&apos;s Free
        </Link>

      </GlassPanel>
    </section>
  );
}