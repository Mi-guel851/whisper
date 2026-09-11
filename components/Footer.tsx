"use client";

import Image from "next/image";
import Link from "next/link";
import DownloadAndroidButton from "./DownloadAndroidButton";

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
      <div className="mx-auto mb-8 flex max-w-7xl flex-col items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-5 backdrop-blur sm:flex-row sm:justify-between">
        <div className="text-center sm:text-left">
          <p className="text-sm font-extrabold" style={{ color: "var(--bridge-text)" }}>
            Whisper for Android — faster, with push
          </p>
          <p className="mt-1 text-xs font-medium" style={{ color: "var(--bridge-text-muted)" }}>
            Get the native app. Same whispers, instant notifications, stays signed in 6 hours.
          </p>
        </div>
        <DownloadAndroidButton variant="primary" size="md" label="Download Android App" />
      </div>
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
