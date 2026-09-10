"use client";

import { useEffect } from "react";
import ErrorScreen from "@/components/ErrorScreen";
import { debugErrorsEnabled } from "@/lib/safeErrorMessage";

/**
 * Last-resort boundary: it catches errors thrown by the root layout itself,
 * which the segment error boundary in app/error.tsx cannot reach.
 *
 * Next requires it to own <html> and <body> because the layout that normally
 * provides them is precisely what just failed — and with it, globals.css and
 * every provider. That is why ErrorScreen is fully self-contained rather than
 * a page fragment.
 *
 * There is no `reset` here in any meaningful sense: re-running the broken
 * layout only throws again. The honest recovery is a full page load, which is
 * what the "Go home" button does.
 *
 * As with the segment boundary, the raw error text reaches the page only for
 * the allowlisted admin accounts.
 */
export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[whisper] fatal app error:", error, error.digest ? `(digest ${error.digest})` : "");
  }, [error]);

  const detail = debugErrorsEnabled()
    ? (error.stack && error.stack.length > 0 ? error.stack : error.message)
    : undefined;

  return (
    <html lang="en">
      <head>
        <title>Whisper</title>
      </head>
      <body>
        <ErrorScreen detail={detail} />
      </body>
    </html>
  );
}
