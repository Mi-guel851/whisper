"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion, useMotionValueEvent, useReducedMotion, useScroll } from "framer-motion";
import { Menu, X } from "lucide-react";
import Logo from "./Logo";
import { ButtonLink } from "./Button";
import { duration, ease } from "@/lib/motion";

const links = [
  { href: "/#how-it-works", label: "How it works" },
  { href: "/#features", label: "Features" },
];

export default function Navbar() {
  const [condensed, setCondensed] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const { scrollY } = useScroll();
  const reduced = useReducedMotion();

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
        className="glass-control mx-auto flex max-w-7xl items-center justify-between gap-2 rounded-2xl sm:rounded-3xl"
        
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
        style={{ paddingLeft: 16, paddingRight: 16 }}
      >
        <Link href="/" aria-label="Whisper home" className="min-w-0">
          <Logo compact showTagline={false} />
        </Link>

        <nav className="hidden items-center gap-8 md:flex">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="nav-link text-[0.9375rem] font-semibold"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <ButtonLink
            href="/login"
            variant="ghost"
            size="sm"
            className="hidden sm:inline-flex"
          >
            Login
          </ButtonLink>
          <ButtonLink href="/signup" size="sm">
            Get link
          </ButtonLink>

          <button
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            aria-expanded={menuOpen}
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            className="grid h-9 w-9 place-items-center rounded-xl md:hidden"
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
            className="glass-control mx-auto mt-2 max-w-7xl overflow-hidden rounded-2xl p-2 md:hidden"
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
          </motion.nav>
        )}
      </AnimatePresence>
    </header>
  );
}
