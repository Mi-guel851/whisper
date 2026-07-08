"use client";

import Link from "next/link";
import Logo from "./Logo";
import { House } from "lucide-react";

export default function Navbar() {
  return (
    <header className="fixed top-0 left-0 right-0 z-50 px-6 pt-6">
      <div
        className="mx-auto flex max-w-7xl items-center justify-between rounded-3xl px-8 py-4 border border-white/10"
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

        <div className="flex items-center gap-4">
          <Link
            href="/login"
            className="rounded-2xl border border-white/10 px-6 py-3 font-semibold text-white transition hover:bg-white/10"
          >
            Login
          </Link>
          <Link
            href="/signup"
            className="rounded-2xl bg-gradient-to-r from-cyan-500 via-purple-500 to-fuchsia-500 px-7 py-3 font-bold text-white transition hover:scale-105"
          >
            Get link
          </Link>
        </div>

      </div>
    </header>
  );
}
