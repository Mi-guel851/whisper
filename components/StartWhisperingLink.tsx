"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { Capacitor } from "@capacitor/core";
import { shouldShowPlatformChoice } from "@/lib/platformChoice";

type Props = {
  className?: string;
  children: React.ReactNode;
  ariaLabel?: string;
};

/**
 * Every "Start Whispering" / "Create My Link" CTA goes through here.
 * Why: the interstitial must gate the *first* time and vanish after.
 * - Native shell: never gate (you are already in the app) → /signup
 * - Web with a stored choice (web|app): → /signup
 * - Web first time: → /choose-platform
 *
 * Using a button + router.push keeps the href honest for crawlers while
 * giving us a synchronous Capacitor check before navigation.
 */
export default function StartWhisperingLink({ className, children, ariaLabel }: Props) {
  const router = useRouter();

  const onClick = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      let isNative = false;
      try {
        isNative = Capacitor.isNativePlatform();
      } catch {}
      const dest = shouldShowPlatformChoice(isNative) ? "/choose-platform" : "/signup";
      router.push(dest);
    },
    [router]
  );

  return (
    <a href="/signup" onClick={onClick} className={className} aria-label={ariaLabel}>
      {children}
    </a>
  );
}
