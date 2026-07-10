// app/components/ClosingCTA.tsx
"use client";

import Link from "next/link";
import Image from "next/image";
import GlassPanel from "./GlassPanel";

export default function ClosingCTA() {
  return (
    <section className="relative mx-auto max-w-5xl px-4 py-16 text-center sm:px-8 sm:py-24">
      <GlassPanel strong className="rounded-[28px] p-8 sm:rounded-[40px] sm:p-16">

        <Image
          src="/ghost.png"
          alt="Whisper"
          width={64}
          height={64}
          className="mx-auto mb-6 animate-pulse drop-shadow-[0_0_18px_rgba(34,211,238,.9)]"
        />

        <h2 className="text-3xl font-black text-white sm:text-5xl">
          Ready to hear the truth?
        </h2>

        <p className="mx-auto mt-4 max-w-xl text-base text-gray-300 sm:text-xl">
          Create your Whisper link and start receiving honest, anonymous messages today.
        </p>

        <Link
          href="/signup"
          className="mt-8 inline-block w-full rounded-2xl bg-gradient-to-r from-cyan-500 to-purple-600 px-10 py-4 text-base font-bold text-white transition hover:scale-105 sm:mt-10 sm:w-auto sm:py-5 sm:text-lg"
        >
          Create My Link — It&apos;s Free
        </Link>

      </GlassPanel>
    </section>
  );
}