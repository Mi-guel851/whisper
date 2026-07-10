"use client";

import Link from "next/link";
import Logo from "./Logo";
import { House } from "lucide-react";

export default function Navbar() {
  return (
    <header className="fixed top-0 left-0 right-0 z-50 px-3 pt-4 sm:px-6 sm:pt-6">
      <div
        className="mx-auto flex max-w-7xl items-center justify-between gap-2 rounded-2xl px-4 py-3 border border-white/10 sm:rounded-3xl sm:px-8 sm:py-4"
        style={{
          background: "rgba(255,255,255,0.08)",
          backdropFilter: "blur(60px) saturate(180%)",
          WebkitBackdropFilter: "blur(60px) saturate(180%)",
        }}
      >

        <Logo />

        <nav className="hidden md:flex items-center gap-8 text-white/80">
          <Link href="/#how-it-works" className="hover:text-white transition">
            How it works
          </Link>
          <Link href="/#features" className="hover:text-white transition">
            Features
          </Link>
        </nav>

        <div className="flex items-center gap-2 sm:gap-4">
          <Link
            href="/login"
            className="rounded-xl border border-white/10 px-3 py-2 text-sm font-semibold text-white transition hover:bg-white/10 sm:rounded-2xl sm:px-6 sm:py-3 sm:text-base"
          >
            Login
          </Link>
          <Link
            href="/signup"
            className="rounded-xl bg-gradient-to-r from-cyan-500 via-purple-500 to-fuchsia-500 px-3 py-2 text-sm font-bold text-white transition hover:scale-105 sm:rounded-2xl sm:px-7 sm:py-3 sm:text-base"
          >
            Get link
          </Link>
        </div>

      </div>
    </header>
  );
}