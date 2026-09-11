"use client";

import { useEffect, useState } from "react";
import { Capacitor } from "@capacitor/core";
import DownloadAndroidButton from "@/components/DownloadAndroidButton";

export default function LandingTopDownloadBanner() {
  const [isNative, setIsNative] = useState(false);

  useEffect(() => {
    try {
      /* Known client-only value: `Capacitor` cannot answer during the server
         pass, so it is read here rather than in the initial state (which would
         make the server and client markup disagree on the banner's presence).
         Same external-system sync the rule's exceptions are for. */
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setIsNative(Capacitor.isNativePlatform());
    } catch {}
  }, []);

  // No banner inside the native shell — you're already in the app.
  if (isNative) return null;

  return (
    <div className="relative z-30 mx-auto max-w-7xl px-3 pt-[4.75rem] sm:px-6 sm:pt-[5.5rem]">
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-white/10 bg-gradient-to-r from-[#0f0a1f]/80 via-[#1a1033]/80 to-[#0f0a1f]/80 px-4 py-3 backdrop-blur-xl md:flex-row md:justify-between md:px-5">
        <div className="flex items-center gap-3 text-center sm:text-left">
          <span className="hidden h-2 w-2 shrink-0 rounded-full bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.8)] sm:inline-block" aria-hidden />
          <p className="text-xs font-semibold leading-5 text-white/80 sm:text-[13px]">
            <span className="font-extrabold text-white">Whisper is on Android</span>
            {/* The long tail is what made the row 662px against a 640px
                breakpoint. It arrives with the width to carry it. */}
            <span className="hidden lg:inline"> — faster, push notifications, stays signed in 6h.</span>
            <span className="lg:hidden"> — get the app for push & speed.</span>
          </p>
        </div>
        <DownloadAndroidButton
          variant="primary"
          size="sm"
          lockup="store"
          label="Download Android App"
          className="w-full shrink-0 md:w-auto"
        />
      </div>
    </div>
  );
}
