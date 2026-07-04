"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import PhoneMockup from "./PhoneMockup";

export default function Hero() {
  return (
    <section className="relative mx-auto flex min-h-screen max-w-5xl flex-col items-center px-8 pt-40 pb-24 text-center">

      <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-cyan-500/20 bg-cyan-500/10 px-5 py-2 text-cyan-300">
        <span className="h-2 w-2 rounded-full bg-cyan-400" />
        👻 Anonymous messages • Images • Reactions
      </div>

      <h1 className="max-w-4xl text-6xl font-black leading-[1.1] text-white md:text-7xl">
        Honest conversations
        <br />
        start with{" "}
        <span className="bg-gradient-to-r from-cyan-400 via-purple-400 to-pink-400 bg-clip-text text-transparent">
          Whisper.
        </span>
      </h1>

      <p className="mt-8 max-w-2xl text-xl leading-9 text-gray-300">
        Create your anonymous profile, receive honest messages,
        anonymous images, and discover what people really think of you.
      </p>

      <div className="mt-10 flex flex-wrap items-center justify-center gap-5">
        <Link
          href="/signup"
          className="flex items-center gap-2 rounded-2xl bg-gradient-to-r from-cyan-500 to-purple-600 px-8 py-4 font-bold text-white transition hover:scale-105"
        >
          Create my link
          <ArrowRight size={18} />
        </Link>
        <Link
          href="/login"
          className="rounded-2xl border border-white/10 bg-white/5 px-8 py-4 font-bold text-white transition hover:bg-white/10"
        >
          Login
        </Link>
      </div>

      <p className="mt-6 text-sm text-gray-500">
        Free forever · No sign-in for senders · End-to-end anonymous
      </p>

      <div className="mt-16">
        <PhoneMockup />
      </div>

    </section>
  );
}