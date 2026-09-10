import { NextRequest, NextResponse } from "next/server";
import { consume, rateLimitedResponse } from "@/lib/apiGuard";

/**
 * Receiver for Content-Security-Policy-Report-Only violations.
 *
 * Report-Only means nothing here is enforced yet — the middleware (see
 * middleware.ts) is a compatibility measurement of Paystack, Next runtime
 * scripts and auth popups against the intended policy. Reports are written to
 * the log, truncated, with the document URL stripped of query/fragment so a
 * one-time-code or OAuth parameter can never be persisted by the reporting
 * pipeline. There is no database table: reports are attacker-writable noise
 * by design, and keeping a durable copy of them would give an attacker a
 * free log-injection target for no investigative gain.
 */

export async function POST(req: NextRequest) {
  try {
    const guard = await consume("csp-report", "shared", 300, 60_000);
    if (guard) return rateLimitedResponse(guard);

    const raw = await req.text();
    if (raw.length > 16_384) return NextResponse.json({ ok: true });

    let parsed: { "csp-report"?: Record<string, unknown> } | Record<string, unknown> | null = null;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return NextResponse.json({ ok: true });
    }
    const report = (parsed && "csp-report" in parsed ? parsed["csp-report"] : parsed) as
      | Record<string, unknown>
      | null;

    const sanitize = (value: unknown): string => {
      const text = String(value ?? "");
      try {
        const url = new URL(text);
        return `${url.origin}${url.pathname}`;
      } catch {
        return text.slice(0, 200);
      }
    };

    console.warn("[csp-report]", {
      document: sanitize(report?.["document-uri"]),
      blocked: sanitize(report?.["blocked-uri"]),
      directive: String(report?.["violated-directive"] ?? report?.["effective-directive"] ?? "").slice(0, 80),
    });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: true });
  }
}
