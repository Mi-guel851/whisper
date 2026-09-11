import { NextResponse, type NextRequest } from "next/server";

/**
 * CSP measurement pass — Report-Only, on purpose.
 *
 * A strict `script-src` policy cannot be enforced the day it is written: it
 * needs a measured inventory of every script the app actually runs in the
 * field (Next runtime chunks, Paystack inline bootstrap, auth popups), and a
 * half-enforced policy that breaks checkout is worse than none. This
 * middleware emits the FULL intended policy with `Content-Security-Policy-
 * Report-Only`, and Next.js consumes the nonce from the request headers the
 * documented way (x-nonce → its inline scripts get the same nonce), so the
 * reports describe exactly what enforcement WOULD block.
 *
 * Flipping to enforcement (after reports are clean for a full deploy cycle)
 * is a one-word change in the header key below. The enforced subset that has
 * always applied (frame-ancestors/object-src/base-uri/form-action) lives in
 * next.config.ts headers() and is untouched — this adds to it, never
 * replaces it.
 */
export const config = {
  matcher: [
    /* Measure document loads and API responses; skip static chunks, images
       and the report sink itself (reports of reports would loop). */
    "/((?!api/csp-report|_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|gif|webp|avif|ico|css|js|woff2?)$).*)",
  ],
};

const PAYSTACK = "https://js.paystack.co https://*.paystackimgs.com";

export function middleware(req: NextRequest) {
  const nonce =
    typeof crypto.randomUUID === "function"
      ? btoa(crypto.randomUUID()).replace(/=+$/g, "")
      : `${Date.now()}${Math.random()}`.replace(/\D/g, "");

  const policy = [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' https: ${PAYSTACK}`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: blob: https:`,
    `font-src 'self' data:`,
    `connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.cloudinary.com https://api.paystack.co ${PAYSTACK}`,
    `frame-src 'self' https://*.paystack.com https://checkout.paystack.com https://accounts.google.com https://www.google.com`,
    `worker-src 'self' blob:`,
    `child-src 'self' blob:`,
    `media-src 'self' blob: data: https://*.supabase.co https://res.cloudinary.com`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    /* Report-only, but it should not cry wolf: a dev preview is legitimately
       framed by the sandbox shell, so the report tracks the same allowlist
       next.config.ts enforces (and stays 'none' in production). */
    process.env.NODE_ENV === "production"
      ? `frame-ancestors 'none'`
      : `frame-ancestors 'self' https://*.e2b.app https://*.arena.site`,
    `upgrade-insecure-requests`,
    `report-uri /api/csp-report`,
  ].join("; ");

  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-nonce", nonce);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy-Report-Only", policy);
  return response;
}
