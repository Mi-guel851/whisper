"use client";

import PlayStoreIcon from "./PlayStoreIcon";
import { PLAY_STORE_URL, PLAY_STORE_READY } from "@/lib/appConfig";

/**
 * "Download app" — one button, every surface that offers the Android build.
 *
 * The mark is the official four-colour Google Play glyph (components/
 * PlayStoreIcon.tsx), not a tinted mono triangle: on a white primary button it
 * has to look like the store, and a `currentColor` glyph there was one more
 * anonymous play triangle. It sits at the button's own scale via `iconSizes`.
 */
type Variant = "primary" | "secondary" | "ghost" | "pill";

export default function DownloadAndroidButton({
  variant = "secondary",
  size = "md",
  className = "",
  onClick,
  label = "Download Android App",
}: {
  variant?: Variant;
  size?: "sm" | "md" | "lg";
  className?: string;
  onClick?: () => void;
  label?: string;
}) {
  const href = PLAY_STORE_READY ? PLAY_STORE_URL : "#";

  const base =
    "inline-flex items-center justify-center gap-2 font-bold whitespace-nowrap transition-all active:scale-[0.98]";

  const sizes: Record<string, string> = {
    sm: "h-9 px-4 text-[12px] rounded-full",
    md: "h-10 px-5 text-[13px] rounded-full",
    lg: "h-11 px-6 text-sm rounded-full",
  };

  /* The store mark is drawn at the button's own scale — a 20px four-colour
     glyph inside an 11rem-wide pill reads as a real store button, where a
     16px one reads as decoration. Sized by height; the mark's width follows. */
  const iconSizes: Record<string, number> = { sm: 18, md: 20, lg: 22 };

  const variants: Record<Variant, string> = {
    primary:
      "bg-white text-[#0a0a0f] shadow-[0_8px_24px_rgba(0,0,0,0.18)] hover:bg-white/90 border border-white/10",
    secondary:
      "bg-white/10 text-white border border-white/15 backdrop-blur hover:bg-white/15 hover:border-white/25",
    ghost:
      "bg-transparent text-white/80 border border-white/15 hover:text-white hover:border-white/30 hover:bg-white/5",
    pill:
      "bg-white text-[#111114] border border-transparent shadow-lg hover:bg-white/95",
  };

  // When the store URL is not yet configured we still render the button but
  // disable navigation and surface a helpful tooltip — the page never 404s.
  if (!PLAY_STORE_READY) {
    return (
      <a
        href="#"
        onClick={(e) => {
          e.preventDefault();
          onClick?.();
        }}
        title="Play Store link coming soon — add NEXT_PUBLIC_PLAY_STORE_URL"
        className={`${base} ${sizes[size]} ${variants[variant]} opacity-70 ${className}`}
        aria-disabled="true"
      >
        <PlayStoreIcon size={iconSizes[size]} />
        {label}
      </a>
    );
  }

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={onClick}
      className={`${base} ${sizes[size]} ${variants[variant]} ${className}`}
    >
      <PlayStoreIcon size={iconSizes[size]} />
      {label}
    </a>
  );
}
