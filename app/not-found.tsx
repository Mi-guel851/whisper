import Link from "next/link";

/**
 * The one face every unknown route shows.
 *
 * Next's built-in 404 is a developer-facing document — a bare status code on a
 * plain card. This is the user-facing one instead: an old link is a normal
 * thing on a social app, and the answer is a door back home, not a status code.
 *
 * Plain page, no state: rendered inside the root layout, so the app's theme
 * and chrome are already on the page.
 */
export default function NotFound() {
  return (
    <div
      className="flex min-h-[70dvh] flex-col items-center justify-center px-6 text-center"
      style={{ background: "var(--theme-bg)", color: "var(--theme-text)" }}
    >
      <img
        src="/ghost.png"
        alt=""
        width={64}
        height={64}
        style={{
          width: 64,
          height: 64,
          filter: "drop-shadow(0 0 18px rgba(34,211,238,0.4))",
        }}
      />

      <h1
        style={{
          marginTop: 18,
          fontSize: "1.375rem",
          fontWeight: 800,
          letterSpacing: "-0.02em",
        }}
      >
        This page drifted off
      </h1>

      <p
        style={{
          marginTop: 8,
          maxWidth: 400,
          fontSize: "0.9375rem",
          lineHeight: 1.55,
          color: "var(--theme-text-secondary)",
        }}
      >
        The link may be old, or the page may have moved. Nothing you sent
        here was lost.
      </p>

      <Link
        href="/"
        className="mt-6 inline-block rounded-[14px] px-6 py-3 text-sm font-bold text-white"
        style={{
          background:
            "linear-gradient(135deg, var(--theme-accent-purple), var(--theme-accent-pink))",
          boxShadow:
            "0 6px 16px rgba(0,0,0,0.32), 0 0 26px rgba(139,92,246,0.3), inset 0 1px 0 rgba(255,255,255,0.24)",
        }}
      >
        Go home
      </Link>
    </div>
  );
}
