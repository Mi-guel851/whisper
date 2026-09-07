"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { LifeBuoy, LogOut, MessageSquareHeart, ShieldOff } from "lucide-react";

import { supabase } from "@/lib/supabase/client";
import { getCachedSession } from "@/lib/supabase/session";
import { formatBanExpiry, useBanStatus } from "@/lib/bans";
import useSafeReducedMotion from "@/lib/useSafeReducedMotion";
import { spring, tween } from "@/lib/motion";

/**
 * The screen a banned account lands on.
 *
 * It is a real route rather than only the BanGate overlay so that the state has
 * a URL: it can be linked, reloaded, and returned to, and it is what BanGate
 * redirects to. `/contact-support` — the existing support page, mailto-based,
 * whisper.anonymous.app@gmail.com — is deliberately reachable from here and is
 * one of the routes BanGate does not gate, because a support link on a ban screen
 * that leads to a second ban screen would be the whole feature failing at the one
 * moment it matters.
 *
 * What it must not do is pretend. There is no "appeal" queue in this codebase;
 * the honest action is "email support", so that is the button.
 */
export default function BannedPage() {
  const { banned, reason, duration, expiresAt, checking, recheck } = useBanStatus();
  const reduced = useSafeReducedMotion();
  const [signedOut, setSignedOut] = useState(false);

  /* A signed-out visitor has no ban to show. Sent to the marketing page rather
     than left on a screen that says "your account" about no account. */
  useEffect(() => {
    async function check() {
      const session = await getCachedSession();
      if (!session) window.location.replace("/");
    }
    void check();
  }, []);

  if (checking) {
    return (
      <main className="grid min-h-screen place-items-center theme-bg-gradient text-white">
        <p className="text-sm text-gray-400">Checking your account…</p>
      </main>
    );
  }

  if (!banned) {
    /* Not an error page — a lifted ban is the good outcome, and the recheck
       button is here because the poll interval is a minute and nobody who has
       just been unbanned wants to wait it out staring at a spinner. */
    return (
      <main className="grid min-h-screen place-items-center px-6 theme-bg-gradient text-white">
        <div className="w-full max-w-sm text-center">
          <h1 className="page-title">Your account is active</h1>
          <p className="page-subtitle mt-2">
            There is no active restriction on this account.
          </p>
          <Link
            href="/dashboard"
            className="mt-6 inline-flex rounded-2xl bg-gradient-to-r from-purple-600 to-purple-500 px-6 py-3 font-bold text-white"
          >
            Back to Whisper
          </Link>
          <button
            type="button"
            onClick={recheck}
            className="mt-4 block w-full text-xs font-semibold text-gray-400 underline underline-offset-4"
          >
            Re-check now
          </button>
        </div>
      </main>
    );
  }

  async function signOut() {
    await supabase.auth.signOut();
    setSignedOut(true);
    window.location.replace("/");
  }

  return (
    <main className="relative grid min-h-screen place-items-center overflow-hidden px-5 py-12 theme-bg-gradient text-white">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 left-1/2 h-[420px] w-[420px] -translate-x-1/2 rounded-full bg-red-600/10 blur-[160px]"
      />

      <motion.div
        initial={reduced ? { opacity: 0 } : { opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={reduced ? tween.base : spring.smooth}
        className="relative w-full max-w-md rounded-[2rem] border border-white/10 p-8 text-center"
        style={{ background: "var(--theme-glass-strong)" }}
      >
        <div className="mx-auto grid h-16 w-16 place-items-center rounded-3xl bg-red-500/15">
          <ShieldOff size={30} className="text-red-300" />
        </div>

        <h1 className="mt-5 text-2xl font-black leading-tight">
          You&apos;ve been banned from Whisper
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-gray-400">
          Your account has been restricted from accessing Whisper. You can&apos;t
          send whispers, messages or posts while this is in place.
        </p>

        {reason && (
          <div className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-4 text-left">
            <span className="block text-[11px] font-bold uppercase tracking-wider text-gray-500">
              Reason
            </span>
            <p className="mt-1.5 text-sm leading-relaxed text-gray-200">{reason}</p>
          </div>
        )}

        {duration === "temporary" && expiresAt ? (
          <p className="mt-4 text-sm text-gray-400">
            Your ban expires on{" "}
            <span className="font-semibold text-gray-200">{formatBanExpiry(expiresAt)}</span>.
            Access returns automatically.
          </p>
        ) : (
          <p className="mt-4 text-sm text-gray-400">This restriction is permanent.</p>
        )}

        <a
          href="/contact-support"
          className="mt-7 flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-purple-600 to-fuchsia-500 py-4 font-bold text-white transition hover:opacity-90"
        >
          <LifeBuoy size={18} />
          Contact Support
        </a>

        <button
          type="button"
          onClick={signOut}
          disabled={signedOut}
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl border border-white/10 py-3.5 text-sm font-semibold text-gray-300 transition hover:bg-white/5 disabled:opacity-50"
        >
          <LogOut size={16} />
          {signedOut ? "Signing out…" : "Sign out"}
        </button>

        <p className="mt-5 inline-flex items-start gap-1.5 text-[11px] leading-relaxed text-gray-500">
          <MessageSquareHeart size={12} className="mt-0.5 flex-none" />
          Nothing you sent has been deleted. Your whispers, messages and coins are
          still on your account.
        </p>
      </motion.div>
    </main>
  );
}
