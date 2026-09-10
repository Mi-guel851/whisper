"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * The face every unhandled failure shows to a person.
 *
 * Rendered by app/error.tsx (segment boundary) and app/global-error.tsx
 * (the root, where even the layout is broken). What it deliberately is NOT:
 * the Next.js default "Application error: a client-side exception has
 * occurred (see the browser console for more information)" page, which is a
 * developer message — it names the browser console and implies a stack a
 * regular user can never read.
 *
 * Self-contained on purpose: global-error runs WITHOUT the root layout, which
 * is also the file that imports globals.css. So this component carries its
 * own inline styles instead of reaching for theme tokens — if it depended on
 * the stylesheet, the one screen that has to work with everything else down
 * would inherit the same breakage it exists to cover.
 */
export default function ErrorScreen({
  onRetry,
  detail,
}: {
  /** Segments can recover in place; the root can only meaningfully go home. */
  onRetry?: () => void;
  /**
   * The real error text (message + stack), shown ONLY when the viewer is one
   * of the allowlisted admin accounts — passed by app/error.tsx and
   * app/global-error.tsx after checking the debug flag. Never rendered for
   * anyone else; the two admin accounts are the people who have to read it.
   */
  detail?: string;
}) {
  const router = useRouter();
  const [leaving, setLeaving] = useState(false);

  function goHome() {
    if (leaving) return;
    setLeaving(true);
    router.replace("/");
  }

  return (
    <div
      style={{
        minHeight: "100dvh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        padding: "0 24px",
        background:
          "radial-gradient(ellipse 80% 50% at 50% -10%, rgba(139,92,246,0.18), transparent), radial-gradient(ellipse 60% 40% at 80% 110%, rgba(236,72,153,0.12), transparent), #000000",
        color: "#ffffff",
        fontFamily:
          'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      }}
    >
      <img
        src="/ghost.png"
        alt=""
        width={72}
        height={72}
        style={{
          width: 72,
          height: 72,
          filter: "drop-shadow(0 0 22px rgba(34,211,238,0.45))",
        }}
      />

      <h1 style={{ marginTop: 20, fontSize: "1.5rem", fontWeight: 800, letterSpacing: "-0.02em" }}>
        Something went wrong
      </h1>

      <p
        style={{
          marginTop: 10,
          maxWidth: 420,
          fontSize: "0.9375rem",
          lineHeight: 1.55,
          color: "#b3b3c0",
        }}
      >
        This is on us, not on you — your messages are safe. Please try again in a
        moment.
      </p>

      {detail && (
        <details
          style={{
            marginTop: 22,
            width: "100%",
            maxWidth: 640,
            textAlign: "left",
            background: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.12)",
            borderRadius: 12,
            overflow: "hidden",
          }}
        >
          <summary
            style={{
              cursor: "pointer",
              padding: "10px 14px",
              fontSize: "0.8125rem",
              fontWeight: 700,
              color: "#fca5a5",
              userSelect: "none",
            }}
          >
            Admin: show the raw error
          </summary>
          <pre
            style={{
              margin: 0,
              padding: "4px 14px 14px",
              fontSize: "0.75rem",
              lineHeight: 1.5,
              color: "#e9e9f0",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              maxHeight: 320,
              overflowY: "auto",
              fontFamily:
                'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
            }}
          >
            {detail}
          </pre>
        </details>
      )}

      <div style={{ marginTop: 26, display: "flex", gap: 12, flexWrap: "wrap", justifyContent: "center" }}>
        {onRetry && (
          <button
            type="button"
            onClick={() => onRetry()}
            style={{
              border: "none",
              borderRadius: 14,
              padding: "12px 26px",
              fontSize: "0.9375rem",
              fontWeight: 700,
              color: "#ffffff",
              cursor: "pointer",
              background: "linear-gradient(135deg, #8b5cf6, #ec4899)",
              boxShadow:
                "0 6px 16px rgba(0,0,0,0.32), 0 0 26px rgba(139,92,246,0.34), inset 0 1px 0 rgba(255,255,255,0.24)",
            }}
          >
            Try again
          </button>
        )}
        <button
          type="button"
          onClick={goHome}
          style={{
            border: "1px solid rgba(139,92,246,0.26)",
            borderRadius: 14,
            padding: "12px 26px",
            fontSize: "0.9375rem",
            fontWeight: 700,
            color: "#e9e9f0",
            cursor: "pointer",
            background: "rgba(139,92,246,0.12)",
          }}
        >
          Go home
        </button>
      </div>
    </div>
  );
}
