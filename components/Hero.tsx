"use client";

import Link from "next/link";
import Ghost from "./Ghost";

export default function Hero() {
  return (
    <section className="relative mx-auto flex min-h-screen max-w-7xl items-center justify-between px-8 pt-44 pb-24">

      <div className="max-w-2xl">

        <div className="mb-6 inline-flex rounded-full border border-cyan-500/20 bg-cyan-500/10 px-5 py-2 text-cyan-300">
          👻 Anonymous Messages • Images • Reactions
        </div>

        <h1 className="text-7xl font-black leading-[1.05] text-white">

          Honest

          <br />

          conversations

          <br />

          start with

          <span className="block bg-gradient-to-r from-cyan-400 via-purple-400 to-pink-400 bg-clip-text text-transparent">
            Whisper.
          </span>

        </h1>

        <p className="mt-8 max-w-xl text-xl leading-9 text-gray-300">
          Create your anonymous profile, receive honest messages,
          anonymous images and discover what people really think.
        </p>

        <div className="mt-12 flex gap-5">

          <Link
            href="/signup"
            className="rounded-2xl bg-gradient-to-r from-cyan-500 to-purple-600 px-8 py-4 font-bold text-white transition hover:scale-105"
          >
            Create My Link
          </Link>

          <Link
            href="/login"
            className="rounded-2xl border border-white/10 bg-white/5 px-8 py-4 font-bold text-white transition hover:bg-white/10"
          >
            Login
          </Link>

        </div>

      </div>

      <Ghost />

    </section>
  );
}