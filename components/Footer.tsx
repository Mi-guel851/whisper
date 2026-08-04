"use client";

import Image from "next/image";
import Link from "next/link";

const legal = [
  { href: "/privacy", label: "Privacy" },
  { href: "/terms", label: "Terms" },
  { href: "/community-guidelines", label: "Guidelines" },
  { href: "/help-center", label: "Help" },
];

export default function Footer() {
  return (
    <footer
      className="px-4 py-10 sm:px-8"
      style={{ borderTop: "1px solid var(--hairline)" }}
    >
      <div className="mx-auto flex max-w-7xl flex-col items-center gap-6 md:flex-row md:justify-between">
        <div className="flex items-center gap-2.5">
          <Image src="/ghost.png" alt="" width={28} height={28} />
          <span
            className="font-bold"
            style={{ color: "var(--bridge-text)" }}
          >
            Whisper
          </span>
        </div>

        <nav className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
          {legal.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="nav-link text-sm font-medium"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        {/* Rendered client-side, so the year can't go stale in a static build.
            `suppressHydrationWarning` because a build that straddles New Year's
            would otherwise mismatch. */}
        <p
          className="text-sm"
          style={{ color: "var(--bridge-text-muted)" }}
          suppressHydrationWarning
        >
          © {new Date().getFullYear()} Whisper. Anonymous messaging, done right.
        </p>
      </div>
    </footer>
  );
}
