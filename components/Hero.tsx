"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import PhoneMockup from "./PhoneMockup";
import AnimatedHeading from "./AnimatedHeading";

export default function Hero() {
  return (
    <section className="relative mx-auto flex min-h-screen max-w-5xl flex-col items-center px-4 pt-28 pb-16 text-center sm:px-8 sm:pt-40 sm:pb-24">

      <div className="mb-6 inline-flex max-w-full flex-wrap items-center justify-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-400/10 px-4 py-2 text-xs text-cyan-400 sm:px-5 sm:text-base font-black">
        <span className="h-2 w-2 shrink-0 rounded-full bg-cyan-400" />
        <span>👻 Anonymous messages • Images • Reactions</span>
      </div>

      <AnimatedHeading />

      <p className="mt-6 max-w-2xl px-2 text-base leading-7 text-gray-300 sm:mt-8 sm:text-xl sm:leading-9 font-medium">
        Create your anonymous profile, receive honest messages,
        anonymous images, and discover what people really think of you.
      </p>

      <div className="mt-8 flex w-full flex-wrap items-center justify-center gap-4 sm:mt-10 sm:w-auto sm:gap-5">
        <Link
          href="/signup"
          className="flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-cyan-400 to-purple-600 px-8 py-4 font-black text-black shadow-lg shadow-cyan-500/20 transition hover:scale-105 active:scale-95 sm:w-auto"
        >
          Create my link
          <ArrowRight size={18} />
        </Link>
        <Link
          href="/login"
          className="w-full rounded-2xl border border-white/10 bg-white/5 px-8 py-4 text-center font-black text-white transition hover:bg-white/10 active:scale-95 sm:w-auto"
        >
          Login
        </Link>
      </div>

      <p className="mt-6 px-4 text-sm text-gray-500">
        Free forever · No sign-in for senders · End-to-end anonymous
      </p>

      <div className="mt-12 w-full sm:mt-16">
        <PhoneMockup />
      </div>

    </section>
  );
}