"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { ShieldOff, LifeBuoy } from "lucide-react";

import { formatBanExpiry, useBanStatus } from "@/lib/bans";
import useSafeReducedMotion from "@/lib/useSafeReducedMotion";
import { spring, tween } from "@/lib/motion";

/**
 * Stops a banned account in its tracks.
 *
 * WHAT THIS IS AND ISN'T
 *
 * This is not the ban. The ban is the set of before-insert triggers and the
 * `can_send_direct_message` clause in 202609080001 §B2, which refuse the write
 * whether the request came from this component's page, from devtools, or from
 * curl. Nothing here needs to be true for a banned account to be unable to post,
 * message, react or move coins.
 *
 * What this is: the reason the person finds out. Without it a banned account
 * opens a dashboard that looks normal, presses send, and gets a database error —
 * which reads as a bug, invites retries, and never says the one thing they need
 * to know.
 *
 * It is deliberately NOT a dismissible dialog. The overlay covers the viewport,
 * takes focus, and routes to /banned; the app behind it is unreachable by tap and
 * by keyboard. Dismissing it would be a lie, because the actions underneath it
 * would still fail.
 *
 * Routes it does not cover: `/banned` itself, the marketing and legal pages, the
 * auth screens, and `/contact-support` — the last one because "Contact Support"
 * on the ban screen has to be reachable, and blocking the page that link goes to
 * would make the only escape hatch a dead end.
 */

const ROUTES_NOT_GATED = new Set([
  "/banned",
  "/contact-support",
  "/login",
  "/signup",
  "/forgot-password",
  "/privacy",
  "/terms",
  "/community-guidelines",
  "/help-center",
  "/feedback",
  "/",
]);

export default function BanGate() {
  const pathname = usePathname();
  const router = useRouter();
  const reduced = useSafeReducedMotion();
  const { banned, reason, duration, expiresAt, checking } = useBanStatus();

  /* Redirect rather than only overlay: /banned is the page that carries the full
     explanation and the support link, and a URL a banned user can bookmark and
     return to is more useful than a modal they have to trigger again. The
     overlay below covers the frame before the navigation lands. */
  useEffect(() => {
    if (!banned) return;
    if (ROUTES_NOT_GATED.has(pathname)) return;
    router.replace("/banned");
  }, [banned, pathname, router]);

  if (!banned || checking) return null;
  if (ROUTES_NOT_GATED.has(pathname)) return null;

  return (
    <motion.div
      role="alertdialog"
      aria-modal="true"
      aria-label="Account restricted"
      initial={reduced ? { opacity: 0 } : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={reduced ? tween.base : spring.smooth}
      /* Above everything, including the toast stack (z-[9999] in
         ToastProvider) — a "message sent" toast floating over a ban notice
         would contradict it. */
      className="fixed inset-0 z-[10000] grid place-items-center overflow-y-auto px-5 py-10"
      style={{
        background: "rgba(5, 1, 15, 0.94)",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
      }}
    >
      <div className="w-full max-w-sm rounded-[1.75rem] border border-white/10 p-7 text-center"
        style={{ background: "var(--theme-glass-strong, rgba(20,12,40,0.9))" }}
      >
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-red-500/15">
          <ShieldOff size={26} className="text-red-300" />
        </div>

        <h1 className="mt-4 text-xl font-black text-white">
          You&apos;ve been banned from Whisper
        </h1>

        <p className="mt-2 text-sm leading-relaxed text-gray-400">
          Your account has been restricted from accessing Whisper.
        </p>

        {reason && (
          <p className="mt-4 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-left text-[13px] leading-relaxed text-gray-300">
            <span className="block text-[11px] font-bold uppercase tracking-wide text-gray-500">
              Reason
            </span>
            {reason}
          </p>
        )}

        {duration === "temporary" && expiresAt && (
          <p className="mt-3 text-[13px] text-gray-400">
            Your ban expires on{" "}
            <span className="font-semibold text-gray-200">{formatBanExpiry(expiresAt)}</span>.
          </p>
        )}

        <a
          href="/contact-support"
          className="mt-6 flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-purple-600 to-purple-500 py-3.5 font-bold text-white transition hover:opacity-90"
        >
          <LifeBuoy size={17} />
          Contact Support
        </a>

        <p className="mt-3 text-[11px] text-gray-500">
          Your messages and data have not been deleted.
        </p>
      </div>
    </motion.div>
  );
}
