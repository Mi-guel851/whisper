/**
 * Best-effort request throttling for the Next.js API routes, with a durable
 * Postgres-backed layer for the sensitive ones.
 *
 * TWO LAYERS, ON PURPOSE
 *
 *  1. Durable (`public.rate_limit_consume`, migration 202609100005). One
 *     fixed-window counter per (bucket, identity) stored in Postgres and
 *     claimed with a single atomic INSERT ... ON CONFLICT, so every Vercel
 *     instance — warm, cold, or newly spawned mid-flood — shares the same
 *     budget. `consume()` below is async and uses this. If the RPC does not
 *     exist yet (migration not applied), the module remembers that once and
 *     degrades to layer 2 instead of failing every request; that degradation
 *     is logged loudly the first time.
 *
 *  2. In-memory (this file's `consumeLocal`). Free and instant; it also kills
 *     single-client scripted floods and covers a same-instance second hit
 *     before the DB round trip is even needed. It resets on instance recycle
 *     and is per-instance, so ALONE it is a speed bump — which is precisely
 *     why the sensitive routes (recovery, admin auth, payments, posting,
 *     media viewing, TURN) must not rely on it.
 *
 * Keys are (route, identifier) pairs where identifier is the client IP for
 * anonymous routes and `ip + user id` for authenticated ones — an attacker
 * rotating JWTs still shares the IP bucket, and one hammering from many IPs
 * still shares the account bucket.
 *
 * FAIL MODES, STATED PLAINLY: a durable-layer DB error on a sensitive bucket
 * fails CLOSED (the request is refused with a retry) rather than open — these
 * guard credential-flavored and money-flavored endpoints; a moment of 429s
 * beats an unlimited brute-force window during an incident. Only the
 * "migration not applied yet" case degrades to the in-memory floor.
 */

type Bucket = { hits: number; expiresAt: number };

/** Above this many tracked keys, drop the stale entries. */
const SWEEP_THRESHOLD = 50_000;

const buckets = new Map<string, Bucket>();

function sweep(now: number) {
  for (const [key, bucket] of buckets) {
    if (now >= bucket.expiresAt) buckets.delete(key);
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

/* --------------------------------------------------------------------------
 * Layer 1 — durable (Postgres)
 * ------------------------------------------------------------------------ */

/**
 * Flipped off the first time the RPC turns out to be missing, so an
 * unapplied migration costs one failed call per instance rather than one per
 * request (the same shape as lib/ai/server/rateLimit.ts).
 */
let durableAvailable = true;
let warnedDurableMissing = false;

function looksMissingFunction(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code === "PGRST202" || error.code === "42883" || error.code === "P0001") return true;
  const message = (error.message ?? "").toLowerCase();
  return message.includes("does not exist") || message.includes("could not find the function");
}

function noteDurableMissing(detail: string) {
  if (warnedDurableMissing) return;
  warnedDurableMissing = true;
  console.error(
    `[apiGuard] durable limiter unavailable (${detail}) — falling back to the per-instance in-memory layer. Apply supabase/migrations/202609100005_durable_guards_and_payments.sql to restore cross-instance budgets.`
  );
}

type DurableVerdict = { allowed?: boolean; retry_after_seconds?: number };

/**
 * Durable allow/deny for one (bucket, identity). Returns null when allowed, a
 * Guard when the caller should be rejected. See the file header for the two
 * degradation modes.
 */
export async function consume(
  name: string,
  identifier: string,
  limit: number,
  windowMs: number
): Promise<Guard | null> {
  if (durableAvailable) {
    try {
      const { getSupabaseAdmin } = await import("@/lib/supabase/admin");
      const admin = getSupabaseAdmin();
      const { data, error } = await admin.rpc("rate_limit_consume", {
        p_bucket: name.slice(0, 64),
        p_identity: identifier.slice(0, 256),
        p_limit: limit,
        p_window_seconds: Math.max(1, Math.ceil(windowMs / 1000)),
      });

      if (error) {
        if (looksMissingFunction(error)) {
          durableAvailable = false;
          noteDurableMissing(error.message ?? error.code ?? "missing function");
        } else {
          // DB answered with a real fault (quota, outage, statement timeout):
          // sensitive buckets fail closed while the fault lasts.
          console.error("[apiGuard] durable limiter error, failing closed:", error.message);
          return { retryAfterSeconds: 30 };
        }
      } else {
        const verdict = (data ?? {}) as DurableVerdict;
        if (verdict.allowed === true) return null;
        return {
          retryAfterSeconds:
            typeof verdict.retry_after_seconds === "number" && verdict.retry_after_seconds > 0
              ? verdict.retry_after_seconds
              : 30,
        };
      }
    } catch (err) {
      // Missing env / client construction error: treat like "not configured
      // yet" so local development and pre-migration deployments keep serving.
      durableAvailable = false;
      noteDurableMissing(err instanceof Error ? err.message : String(err));
    }
  }

  return consumeLocal(name, identifier, limit, windowMs);
}

/**
 * A single durable guard for several identities (e.g. IP *and* user id),
 * where passing means passing on both. The tightest failure wins so the
 * response can carry the correct Retry-After.
 */
export async function consumeMulti(
  name: string,
  identities: string[],
  limit: number,
  windowMs: number
): Promise<Guard | null> {
  let worst: Guard | null = null;
  for (const identifier of identities) {
    const verdict = await consume(name, identifier, limit, windowMs);
    if (verdict && (!worst || verdict.retryAfterSeconds > worst.retryAfterSeconds)) worst = verdict;
  }
  return worst;
}

/* --------------------------------------------------------------------------
 * Layer 2 — in-memory floor
 * ------------------------------------------------------------------------ */

/**
 * Allow/deny for one (name, identifier) pair, `limit` hits per `windowMs`,
 * in THIS instance only. Returns null when allowed, a Guard when the caller
 * should be rejected. Public so the durable layer can degrade to it — new
 * sensitive call sites should use `consume` instead.
 */
export function consumeLocal(name: string, identifier: string, limit: number, windowMs: number): Guard | null {
  const now = Date.now();
  if (buckets.size >= SWEEP_THRESHOLD) sweep(now);

  const key = `${name}:${identifier}`;
  const bucket = buckets.get(key);

  if (!bucket || now >= bucket.expiresAt) {
    // Fail closed for new identities when full; never evict an active limit.
    if (!bucket && buckets.size >= SWEEP_THRESHOLD) return { retryAfterSeconds: 60 };
    buckets.set(key, { hits: 1, expiresAt: now + windowMs });
    return null;
  }

  bucket.hits += 1;
  if (bucket.hits <= limit) return null;

  const retryAfterMs = bucket.expiresAt - now;
  return { retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)) };
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
