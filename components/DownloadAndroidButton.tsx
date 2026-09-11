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
 *
 * TWO LOCKUPS
 *
 * `inline` is mark + one-line label. It is fine where the button owns a row of
 * its own, but the label is long: "Download Android app — Get it on Google Play"
 * measured 307px in Roboto, and the hero column gives it 288px on a 320px phone.
 *
 * `store` is the badge lockup every real store button uses — the mark beside a
 * two-line "Get it on / Google Play". Measured at 142–150px it is *less than
 * half* the width while saying more, which is why the constrained surfaces (the
 * hero, the navbar) ask for it. Same mark, same link, same hit target; only the
 * arrangement of the words changes.
 *
 * In `store` mode the visible words are the badge's, but the anchor still
 * carries `label` as its accessible name, so a screen reader hears the full
 * "Download Android App" the inline lockup would have shown.
 */
type Variant = "primary" | "secondary" | "ghost" | "pill";
type Lockup = "inline" | "store";

export default function DownloadAndroidButton({
  variant = "secondary",
  size = "md",
  className = "",
  onClick,
  label = "Download Android App",
  lockup = "inline",
}: {
  variant?: Variant;
  size?: "sm" | "md" | "lg";
  className?: string;
  onClick?: () => void;
  label?: string;
  /** `store` swaps the one-line label for the badge's two-line lockup. */
  lockup?: Lockup;
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

  /* The badge lockup is text-led: the mark is as tall as the two type lines
     together, which is what makes it read as a badge rather than an icon with
     a caption. Sizing the text instead would leave the mark looking clipped. */
  const storeMarkSizes: Record<string, number> = { sm: 26, md: 28, lg: 30 };

  const isStore = lockup === "store";
  const markSize = isStore ? storeMarkSizes[size] : iconSizes[size];

  /* A two-line lockup needs a taller pill than one line of text does. */
  const storeSizes: Record<string, string> = {
    sm: "h-10 px-4 rounded-full",
    md: "h-11 px-5 rounded-full",
    lg: "h-12 px-6 rounded-full",
  };
  const sizeClasses = isStore ? storeSizes[size] : sizes[size];

  /* The badge's own words, in the badge's own arrangement. "Get it on" is
     rendered as written and uppercased in CSS: a screen reader says the words,
     not the letters. */
  const storeLabel = (
    <span className="flex flex-col items-start text-left leading-none">
      <span className="text-[10px] font-bold uppercase tracking-[0.12em] opacity-75">
        Get it on
      </span>
      <span className="mt-[3px] text-[14px] font-extrabold tracking-[-0.01em]">
        Google Play
      </span>
    </span>
  );

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
        className={`${base} ${sizeClasses} ${variants[variant]} opacity-70 ${className}`}
        aria-disabled="true"
        aria-label={isStore ? label : undefined}
      >
        <PlayStoreIcon size={markSize} />
        {isStore ? storeLabel : label}
      </a>
    );
  }

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={onClick}
      className={`${base} ${sizeClasses} ${variants[variant]} ${className}`}
      aria-label={isStore ? label : undefined}
    >
      <PlayStoreIcon size={markSize} />
      {isStore ? storeLabel : label}
    </a>
  );
}
