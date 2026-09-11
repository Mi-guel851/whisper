"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Capacitor } from "@capacitor/core";
import { PLAY_STORE_URL, PLAY_STORE_READY } from "@/lib/appConfig";
import { getPlatformChoice, setPlatformChoice, shouldShowPlatformChoice } from "@/lib/platformChoice";
import PlayStoreIcon from "@/components/PlayStoreIcon";

export default function ChoosePlatformPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  // Native OR already-chosen users never see this interstitial — bounce to signup.
  useEffect(() => {
    let isNative = false;
    try {
      isNative = Capacitor.isNativePlatform();
    } catch {}
    if (!shouldShowPlatformChoice(isNative)) {
      // Small delay so the redirect doesn't flash on a deliberate visit.
      // We check again inside to avoid bouncing someone who intentionally
      // navigated to /choose-platform to change their mind.
      const existing = getPlatformChoice();
      if (isNative || existing) {
        router.replace("/signup");
        return;
      }
    }
    setReady(true);
  }, [router]);

  if (!ready) {
    return (
      <div className="min-h-[100dvh] grid place-items-center bg-[#050208] text-white">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-white/20 border-t-white/80" aria-hidden />
      </div>
    );
  }

  const onContinueWeb = () => {
    setPlatformChoice("web");
    router.push("/signup");
  };

  const onDownloadApp = () => {
    setPlatformChoice("app");
    if (PLAY_STORE_READY) {
      window.open(PLAY_STORE_URL, "_blank", "noopener,noreferrer");
    }
    // Keep them here with the store in a new tab — they can still continue on web.
    // A subtle nudge push to signup after marking choice makes the next
    // "Start whispering" skip this gate as promised.
  };

  return (
    <main className="min-h-[100dvh] bg-[#050208] text-white selection:bg-[#8b5cf6]/30">
      {/* aurora — same family as auth-shell so this feels like part of the product, not a marketing detour */}
      <div aria-hidden className="pointer-events-none fixed inset-0 overflow-hidden">
        <span className="absolute -top-28 -left-24 h-[30rem] w-[30rem] rounded-full bg-[rgba(124,58,237,0.45)] blur-[90px]" />
        <span className="absolute -bottom-24 -right-16 h-[28rem] w-[28rem] rounded-full bg-[rgba(168,85,247,0.28)] blur-[90px]" />
        <span className="absolute left-1/2 top-[46%] h-[20rem] w-[20rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[rgba(236,72,153,0.13)] blur-[80px]" />
      </div>

      <div className="relative mx-auto flex min-h-[100dvh] max-w-[1080px] flex-col px-4 py-6 sm:px-6 sm:py-10">
        {/* top bar */}
        <div className="flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5 text-white">
            <img src="/icon-192.png" alt="" width={28} height={28} className="h-7 w-7 rounded-lg object-cover" />
            <span className="text-[15px] font-extrabold tracking-tight">Whisper</span>
            <span className="hidden sm:inline text-[10px] font-bold tracking-[0.16em] text-white/60">ANONYMOUS</span>
          </Link>
          <Link href="/" className="text-xs font-semibold text-white/60 hover:text-white">
            Back to home
          </Link>
        </div>

        <div className="mx-auto mt-8 flex w-full max-w-[960px] flex-1 flex-col gap-6 sm:mt-10">
          <div className="text-center">
            <div className="mx-auto inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.06] px-3.5 py-1.5 backdrop-blur">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.7)]" aria-hidden />
              <span className="text-[11px] font-bold tracking-[0.14em] text-white/70">ONE QUICK CHOICE</span>
            </div>
            <h1 className="mx-auto mt-4 max-w-[22ch] text-balance text-[28px] font-extrabold leading-[1.05] tracking-[-0.03em] sm:text-[36px]">
              Continue on this site
              <span className="bg-gradient-to-r from-[#22d3ee] via-[#8b5cf6] to-[#ec4899] bg-clip-text text-transparent"> or get the app?</span>
            </h1>
            <p className="mx-auto mt-3 max-w-[56ch] text-pretty text-[13.5px] leading-6 text-white/65">
              Whisper works perfectly in your browser. The Android app adds push, speed, and a home-screen home for your whispers — pick what suits you. You can change anytime.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 sm:gap-5">
            {/* Continue on Web */}
            <div className="group relative flex flex-col rounded-[20px] border border-white/10 bg-white/[0.06] p-5 backdrop-blur-xl sm:p-6">
              <div className="flex items-center gap-3">
                <div className="grid h-9 w-9 place-items-center rounded-xl bg-white/10 text-white">
                  <svg width={18} height={18} viewBox="0 0 24 24" fill="none" aria-hidden>
                    <path d="M12 3a9 9 0 100 18 9 9 0 000-18Zm0 0a9 9 0 011.8.18M3 12h18M12 3c1.8 2.3 2.8 5 2.8 9s-1 6.7-2.8 9M12 3C10.2 5.3 9.2 8 9.2 12s1 6.7 2.8 9" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" />
                  </svg>
                </div>
                <div>
                  <h2 className="text-[15px] font-extrabold tracking-tight">Continue on site</h2>
                  <p className="text-xs font-medium text-white/60">No download — you’re in in seconds</p>
                </div>
              </div>
              <ul className="mt-4 grid gap-2 text-[12.5px] leading-5 text-white/70">
                <li className="flex gap-2"><span className="text-emerald-300">✓</span> Instant access, works on any device</li>
                <li className="flex gap-2"><span className="text-emerald-300">✓</span> Same anonymous whispers, same inbox</li>
                <li className="flex gap-2"><span className="text-emerald-300">✓</span> Remembers your choice — no second interstitial</li>
              </ul>
              <button
                onClick={onContinueWeb}
                className="mt-5 inline-flex h-11 items-center justify-center gap-2 rounded-full bg-white px-6 text-sm font-extrabold text-[#0a0a0f] shadow-[0_10px_28px_rgba(0,0,0,0.35)] transition hover:bg-white/90 active:scale-[0.99]"
              >
                Continue on site
                <span aria-hidden>→</span>
              </button>
              <p className="mt-2 text-center text-[11px] font-medium text-white/45">Takes you to “Continue with Google”</p>
            </div>

            {/* Download App */}
            <div className="relative flex flex-col overflow-hidden rounded-[20px] border border-white/10 bg-gradient-to-br from-[#1a1033] via-[#1a1033] to-[#23104c] p-5 sm:p-6">
              <div aria-hidden className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-[rgba(139,92,246,0.22)] blur-2xl" />
              <div className="flex items-center gap-3">
                <div className="grid h-9 w-9 place-items-center rounded-xl bg-white text-[#1a1033]">
                  <PlayStoreIcon size={18} />
                </div>
                <div>
                  <h2 className="text-[15px] font-extrabold tracking-tight">Download Android app</h2>
                  <p className="text-xs font-medium text-white/70">Best for daily whispering</p>
                </div>
                <span className="ml-auto hidden rounded-full bg-white px-2.5 py-1 text-[10px] font-extrabold tracking-widest text-[#1a1033] sm:inline-flex">RECOMMENDED</span>
              </div>

              <ul className="mt-4 grid gap-2 text-[12.5px] leading-5 text-white/80">
                <li className="flex gap-2"><span className="text-[#22d3ee]">✦</span> <span><b className="font-bold text-white">Instant push</b> — never miss a reply</span></li>
                <li className="flex gap-2"><span className="text-[#22d3ee]">✦</span> <span><b className="font-bold text-white">Faster & smoother</b> — no browser chrome</span></li>
                <li className="flex gap-2"><span className="text-[#22d3ee]">✦</span> <span><b className="font-bold text-white">Stays signed in 6h</b> — pick up where you left off</span></li>
                <li className="flex gap-2"><span className="text-[#22d3ee]">✦</span> <span><b className="font-bold text-white">Home-screen icon</b> & system share</span></li>
              </ul>

              <a
                /* Marked for the pre-paint rule in globals.css. Native users are
                   already bounced to /signup by the effect above and never see
                   this card, but the marker means that if the redirect is ever
                   delayed, the store offer is hidden before the first paint
                   rather than mid-redirect. */
                data-download-app="true"
                href={PLAY_STORE_READY ? PLAY_STORE_URL : "#"}
                target={PLAY_STORE_READY ? "_blank" : undefined}
                rel={PLAY_STORE_READY ? "noopener noreferrer" : undefined}
                onClick={(e) => {
                  if (!PLAY_STORE_READY) e.preventDefault();
                  onDownloadApp();
                }}
                className="mt-5 inline-flex h-11 items-center justify-center gap-2.5 rounded-full bg-white px-6 text-sm font-extrabold text-[#0a0a0f] shadow-[0_10px_28px_rgba(0,0,0,0.35)] transition hover:bg-white/90 active:scale-[0.99]"
              >
                <PlayStoreIcon />
                Get it on Google Play
              </a>
              <p className="mt-2 text-center text-[11px] font-medium text-white/55">
                {PLAY_STORE_READY ? "Opens Play Store in a new tab" : "Store link coming soon — your build will fill NEXT_PUBLIC_PLAY_STORE_URL"}
              </p>

              {!PLAY_STORE_READY && (
                <p className="mt-3 rounded-xl border border-amber-300/20 bg-amber-300/10 px-3 py-2 text-center text-xs leading-5 text-amber-100/90">
                  Developer account pending. Add your URL to <code className="rounded bg-black/30 px-1 py-0.5 font-mono text-[11px]">NEXT_PUBLIC_PLAY_STORE_URL</code> and this button lights up — no code change needed.
                </p>
              )}
            </div>
          </div>

          <div className="flex flex-col items-center gap-3 pt-1 text-center">
            <p className="max-w-[60ch] text-xs leading-5 text-white/45">
              You picked an option? Whisper remembers — next time <b className="font-semibold text-white/70">“Start whispering”</b> goes straight to Continue with Google. Installed the app? You’ll never see this screen again.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-3 text-xs">
              <button onClick={onContinueWeb} className="font-semibold text-white/70 underline decoration-white/20 underline-offset-4 hover:text-white hover:decoration-white/40">
                Skip — continue on site
              </button>
              <span className="hidden text-white/20 sm:inline">·</span>
              <Link href="/login" className="font-semibold text-white/50 hover:text-white">
                Already have an account? Log in
              </Link>
            </div>
          </div>
        </div>

        <p className="mt-6 text-center text-[11px] font-medium tracking-wide text-white/25">
          whisper • anonymous whispers, delivered instantly
        </p>
      </div>
    </main>
  );
}
