/**
 * Per-user abuse protection for Whispers AI.
 *
 * Two layers, because they cover different failure modes:
 *
 *  1. In-memory (this server instance). Free, instant, and it also catches the
 *     case a database can't cheaply catch — the same user firing a second
 *     question while the first is still in flight. It resets when the instance
 *     recycles and isn't shared between concurrent instances, so on its own it's
 *     a speed bump, not a guarantee.
 *
 *  2. Durable (Postgres). One `security definer` RPC, keyed by user id, storing
 *     counters only — never a question, never an answer. This is the layer that
 *     actually protects the Gemini allowance, and the only one that holds across
 *     the several serverless instances Vercel may have warm at once.
 *
 * Layer 2 is optional: if its migration hasn't been applied the route keeps
 * working on layer 1 alone and logs once. That's deliberate — a missing
 * migration should degrade the guard, not take the assistant down.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { LIMITS } from "./config";

/* --------------------------------------------------------------------------
 * Layer 1 — in-memory
 * ------------------------------------------------------------------------ */

/** userId -> request timestamps (ms) inside the current window. */
const recentRequests = new Map<string, number[]>();

/** Users with a request currently being served by this instance. */
const inFlight = new Set<string>();

/** Above this many tracked users, sweep the map before adding more. */
const SWEEP_THRESHOLD = 2_000;

function sweep(now: number) {
  const cutoff = now - LIMITS.WINDOW_SECONDS * 1000;
  for (const [userId, stamps] of recentRequests) {
    const live = stamps.filter((stamp) => stamp > cutoff);
    if (live.length === 0) recentRequests.delete(userId);
    else recentRequests.set(userId, live);
  }
}

export type LocalVerdict =
  | { allowed: true }
  | { allowed: false; reason: "in_flight" }
  | { allowed: false; reason: "rate_limited"; retryAfterSeconds: number };

/**
 * Records an attempt and says whether it may proceed.
 *
 * Call `releaseLocal` in a `finally` for every call that returns `allowed`, or
 * the user stays locked out of their own assistant until the instance recycles.
 */
export function checkLocal(userId: string): LocalVerdict {
  if (inFlight.has(userId)) return { allowed: false, reason: "in_flight" };

  const now = Date.now();
  if (recentRequests.size > SWEEP_THRESHOLD) sweep(now);

  const cutoff = now - LIMITS.WINDOW_SECONDS * 1000;
  const stamps = (recentRequests.get(userId) ?? []).filter((stamp) => stamp > cutoff);

  if (stamps.length >= LIMITS.REQUESTS_PER_WINDOW) {
    const oldest = stamps[0];
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((oldest + LIMITS.WINDOW_SECONDS * 1000 - now) / 1000)
    );
    recentRequests.set(userId, stamps);
    return { allowed: false, reason: "rate_limited", retryAfterSeconds };
  }

  stamps.push(now);
  recentRequests.set(userId, stamps);
  inFlight.add(userId);

  return { allowed: true };
}

export function releaseLocal(userId: string) {
  inFlight.delete(userId);
}

/* --------------------------------------------------------------------------
 * Layer 2 — durable
 * ------------------------------------------------------------------------ */

const RPC = "whispers_ai_touch_rate_limit";

/**
 * Flipped off permanently for this instance the first time the RPC turns out not
 * to exist, so an unapplied migration costs one failed call rather than one per
 * request.
 */
let durableAvailable = true;

export type DurableVerdict =
  | { allowed: true; remainingWindow: number | null; remainingDay: number | null }
  | { allowed: false; scope: "window" | "day"; retryAfterSeconds: number };

type RpcRow = {
  allowed?: boolean;
  scope?: string;
  retry_after_seconds?: number;
  remaining_window?: number;
  remaining_day?: number;
};

function looksMissing(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  // PGRST202: PostgREST couldn't find a function matching the signature.
  if (error.code === "PGRST202" || error.code === "42883") return true;
  const message = (error.message ?? "").toLowerCase();
  return message.includes("could not find the function") || message.includes("does not exist");
}

export async function checkDurable(
  admin: SupabaseClient,
  userId: string
): Promise<DurableVerdict> {
  const permissive: DurableVerdict = {
    allowed: true,
    remainingWindow: null,
    remainingDay: null,
  };

  if (!durableAvailable) return permissive;

  try {
    const { data, error } = await admin.rpc(RPC, {
      target_user: userId,
      max_per_window: LIMITS.REQUESTS_PER_WINDOW,
      window_seconds: LIMITS.WINDOW_SECONDS,
      max_per_day: LIMITS.REQUESTS_PER_DAY,
    });

    if (error) {
      if (looksMissing(error)) {
        durableAvailable = false;
        console.warn(
          `[whispers-ai] ${RPC} not found — durable rate limiting is off until supabase/migrations/202608120001_whispers_ai_rate_limit.sql is applied. In-memory limits still apply.`
        );
        return permissive;
      }
      // A transient database problem must not become an outage for the user.
      console.error("[whispers-ai] rate limit RPC failed:", error.message);
      return permissive;
    }

    const row = (data ?? {}) as RpcRow;

    if (row.allowed === false) {
      return {
        allowed: false,
        scope: row.scope === "day" ? "day" : "window",
        retryAfterSeconds: Math.max(1, Number(row.retry_after_seconds ?? LIMITS.WINDOW_SECONDS)),
      };
    }

    return {
      allowed: true,
      remainingWindow:
        typeof row.remaining_window === "number" ? row.remaining_window : null,
      remainingDay: typeof row.remaining_day === "number" ? row.remaining_day : null,
    };
  } catch (cause) {
    console.error("[whispers-ai] rate limit check threw:", cause);
    return permissive;
  }
}
