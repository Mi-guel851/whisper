/**
 * Best-effort request throttling for the Next.js API routes.
 *
 * WHY THIS IS "BEST EFFORT" — READ BEFORE RELYING ON IT
 *
 * Vercel runs this app across many serverless instances. The counters below
 * live in one instance's memory, so a distributed attacker can multiply every
 * budget by the number of warm instances they can land on. What this layer
 * *does* buy, cheaply and with zero new infrastructure:
 *
 *   - it kills single-client scripted floods (one browser, one session, one
 *     instance in practice — the realistic 95% case for these endpoints),
 *   - it makes the credential-flavored endpoints (/api/reset-with-phrase,
 *     /api/admin/verify-pin) slow to brute-force instead of free,
 *   - it caps per-user burn on the paid third-party proxies (Tenor/Giphy).
 *
 * The durable, multi-instance guarantee is a Redis/WAF counter (Upstash
 * Ratelimit or Vercel Firewall rules). That is called out in the audit report
 * as the production fix; this module is the floor, not the ceiling. The
 * interface is deliberately shaped so the same call sites can be swapped to
 * Upstash without touching semantics.
 *
 * Keys are (route, identifier) pairs where identifier is the client IP for
 * anonymous routes and `ip + user id` for authenticated ones — an attacker
 * rotating JWTs still shares the IP bucket, and one hammering from many IPs
 * still shares the account bucket.
 */

type Bucket = { hits: number; windowStart: number };

/** Above this many tracked keys, drop the stale entries. */
const SWEEP_THRESHOLD = 50_000;

const buckets = new Map<string, Bucket>();

function sweep(now: number) {
  for (const [key, bucket] of buckets) {
    if (now - bucket.windowStart > 10 * 60_000) buckets.delete(key);
  }
}

/**
 * The client IP as Vercel reports it. `x-forwarded-for` can carry a client-side
 * forged first hop in some proxies; Vercel normalizes it, and this is a
 * best-effort limiter, so the trade of taking the header is acceptable here —
 * it is explicitly NOT used for any authorization decision.
 */
export function clientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return headers.get("x-real-ip") ?? "unknown";
}

export type Guard = {
  /** Seconds until the current window resets; for Retry-After. */
  retryAfterSeconds: number;
};

/**
 * Allow/deny for one (name, identifier) pair, `limit` hits per `windowMs`.
 * Returns null when allowed, a Guard when the caller should be rejected.
 */
export function consume(name: string, identifier: string, limit: number, windowMs: number): Guard | null {
  const now = Date.now();
  if (buckets.size > SWEEP_THRESHOLD) sweep(now);

  const key = `${name}:${identifier}`;
  const bucket = buckets.get(key);

  if (!bucket || now - bucket.windowStart >= windowMs) {
    buckets.set(key, { hits: 1, windowStart: now });
    return null;
  }

  bucket.hits += 1;
  if (bucket.hits <= limit) return null;

  const retryAfterMs = bucket.windowStart + windowMs - now;
  return { retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)) };
}

/**
 * A single guard for several identities (e.g. IP *and* user id), where passing
 * means passing on both. The tightest failure wins so the response can carry
 * the correct Retry-After.
 */
export function consumeMulti(
  name: string,
  identities: string[],
  limit: number,
  windowMs: number
): Guard | null {
  let worst: Guard | null = null;
  for (const identifier of identities) {
    const verdict = consume(name, identifier, limit, windowMs);
    if (verdict && (!worst || verdict.retryAfterSeconds > worst.retryAfterSeconds)) worst = verdict;
  }
  return worst;
}

/**
 * The standard 429 body, shaped like every other error this app returns.
 * Pass a `retryAfterSeconds` and clients can back off honestly.
 */
export function rateLimitedResponse(guard: Guard): Response {
  return new Response(
    JSON.stringify({ error: "Too many requests. Please slow down.", retryAfterSeconds: guard.retryAfterSeconds }),
    {
      status: 429,
      headers: {
        "Content-Type": "application/json",
        "Retry-After": String(guard.retryAfterSeconds),
        "Cache-Control": "no-store",
      },
    }
  );
}
