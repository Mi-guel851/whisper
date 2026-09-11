"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion, useMotionValueEvent, useReducedMotion, useScroll } from "framer-motion";
import { Menu, X } from "lucide-react";
import Logo from "./Logo";
import { ButtonLink } from "./Button";
import DownloadAndroidButton from "./DownloadAndroidButton";
import { duration, ease } from "@/lib/motion";
import { useRouter } from "next/navigation";
import { Capacitor } from "@capacitor/core";
import { shouldShowPlatformChoice } from "@/lib/platformChoice";

/**
 * Only routes that actually exist. A marketing nav that links to a 404 costs
 * more trust than the extra link buys, so there's no "Blog" here until there's
 * a blog — "Pricing" and "Safety" point at the real pages behind those words.
 */
const links = [
  { href: "/#features", label: "Features" },
  { href: "/#how-it-works", label: "How it works" },
  { href: "/premium", label: "Pricing" },
  { href: "/community-guidelines", label: "Safety" },
];

export default function Navbar() {
  const router = useRouter();
  const [condensed, setCondensed] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const { scrollY } = useScroll();
  const reduced = useReducedMotion();

  const handleStartWhispering = (e: React.MouseEvent) => {
    e.preventDefault();
    let isNative = false;
    try { isNative = Capacitor.isNativePlatform(); } catch {}
    router.push(shouldShowPlatformChoice(isNative) ? "/choose-platform" : "/signup");
  };

  // Subscribed via motion value rather than a scroll listener + setState, so
  // this only re-renders on the two frames where the boolean actually flips.
  useMotionValueEvent(scrollY, "change", (value) => {
    setCondensed(value > 24);
  });

  // A fixed-position menu over a scrollable page must lock the page, or the
  // content slides behind the open sheet.
  useEffect(() => {
    if (!menuOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [menuOpen]);

  return (
    <header className="fixed inset-x-0 top-0 z-50 px-3 pt-4 sm:px-6 sm:pt-6">
      <motion.div
        // Flex while the links are hidden, a three-track grid once they show.
        // Centring the nav with `justify-between` would only look centred while
        // the logo and the action cluster happen to be the same width; the
        // `1fr auto 1fr` grid keeps it centred against the *bar*, which is what
        // the eye actually measures against.
        className="glass-control mx-auto flex max-w-7xl items-center justify-between gap-2 rounded-2xl px-3 sm:rounded-3xl sm:px-4 lg:grid lg:grid-cols-[1fr_auto_1fr]"
        animate={{
          paddingTop: condensed ? 8 : 12,
          paddingBottom: condensed ? 8 : 12,
          boxShadow: condensed
            ? "var(--elev-4), var(--elev-rim)"
            : "var(--elev-2), var(--elev-rim)",
        }}
        transition={
          reduced
            ? { duration: 0 }
            : { duration: duration.base, ease: ease.outQuint }
        }
      >
        <Link
          href="/"
          aria-label="Whisper home"
          className="min-w-0 lg:justify-self-start"
        >
          <Logo compact showTagline={false} />
        </Link>

        <nav className="hidden items-center gap-6 lg:flex lg:justify-self-center">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="nav-link whitespace-nowrap text-[0.9375rem] font-semibold"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2 lg:justify-self-end">
          <DownloadAndroidButton
            variant="ghost"
            size="sm"
            lockup="store"
            className="hidden xl:inline-flex"
            label="Download the Android app"
          />
          <ButtonLink
            href="/login"
            variant="ghost"
            size="sm"
            className="hidden sm:inline-flex"
          >
            Login
          </ButtonLink>
          {/* Two words, or one. Measured in Roboto, "Start Whispering" is 94px
              of text: with the logo, the menu button and the bar's own padding
              that came to 331px inside a 320px phone, so the bar was clipping
              its own menu button on the narrowest devices. "Start" carries the
              same offer in 36px, and the accessible name keeps the full one —
              WCAG's label-in-name rule is satisfied either way, because the
              visible word is contained in it. */}
          <a
            href="/signup"
            onClick={handleStartWhispering}
            aria-label="Start Whispering"
            className="premium-button premium-button-primary h-9 px-4 text-[13px] rounded-full inline-flex items-center justify-center gap-2 font-bold whitespace-nowrap sm:px-5"
          >
            <span className="sm:hidden">Start</span>
            <span className="hidden sm:inline">Start Whispering</span>
          </a>

          <button
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            aria-expanded={menuOpen}
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            className="grid h-9 w-9 place-items-center rounded-xl lg:hidden"
            style={{
              color: "var(--bridge-text)",
              background: "var(--fill-2)",
              border: "1px solid var(--hairline)",
            }}
          >
            {/* Crossfade the two glyphs rather than swapping them — an instant
                swap at this size reads as a flicker. */}
            <AnimatePresence initial={false} mode="wait">
              <motion.span
                key={menuOpen ? "close" : "open"}
                initial={{ opacity: 0, rotate: reduced ? 0 : -90 }}
                animate={{ opacity: 1, rotate: 0 }}
                exit={{ opacity: 0, rotate: reduced ? 0 : 90 }}
                transition={{ duration: duration.fast, ease: ease.outQuint }}
                className="grid place-items-center"
              >
                {menuOpen ? <X size={18} /> : <Menu size={18} />}
              </motion.span>
            </AnimatePresence>
          </button>
        </div>
      </motion.div>

      <AnimatePresence>
        {menuOpen && (
          <motion.nav
            key="mobile-menu"
            initial={{ opacity: 0, y: reduced ? 0 : -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: reduced ? 0 : -8 }}
            transition={{ duration: duration.fast, ease: ease.outQuint }}
            className="glass-control mx-auto mt-2 max-w-7xl overflow-hidden rounded-2xl p-2 lg:hidden"
          >
            {links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setMenuOpen(false)}
                className="block rounded-xl px-4 py-3 text-[0.9375rem] font-semibold"
                style={{ color: "var(--bridge-text)" }}
              >
                {link.label}
              </Link>
            ))}
            <Link
              href="/login"
              onClick={() => setMenuOpen(false)}
              className="block rounded-xl px-4 py-3 text-[0.9375rem] font-semibold sm:hidden"
              style={{ color: "var(--bridge-text)" }}
            >
              Login
            </Link>
            <div className="mt-2 grid gap-2 px-2 pb-1">
              <DownloadAndroidButton variant="secondary" size="md" className="w-full" label="Download Android App" />
              <a
                href="/signup"
                onClick={(e) => {
                  setMenuOpen(false);
                  handleStartWhispering(e);
                }}
                className="premium-button premium-button-primary h-11 w-full rounded-full text-sm inline-flex items-center justify-center gap-2 font-bold"
              >
                Start Whispering
              </a>
            </div>
          </motion.nav>
        )}
      </AnimatePresence>
    </header>
  );
}
