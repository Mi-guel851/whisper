import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { timingSafeEqual } from "crypto";
import type { NextRequest } from "next/server";
import { clientIp, consumeMulti, rateLimitedResponse, type Guard } from "@/lib/apiGuard";
import { isAdminEmail } from "@/lib/admin/emails";

/**
 * The one authorization boundary for every admin operation.
 *
 * WHY THIS MODULE EXISTS, AND WHY NOTHING IN /admin IS ALLOWED TO SKIP IT
 *
 * The panel has three credentials, and no one of them is sufficient alone:
 *
 *   1. A signed-in account. Established by handing the caller's own access
 *      token to `supabase.auth.getUser()`, which is the only way to validate a
 *      JWT without trusting its contents — decoding one is not verifying one.
 *      This puts a real user id in every audit row.
 *
 *   2. AN ALLOWLISTED EMAIL. lib/admin/emails.ts — the two accounts that have
 *      been able to grant coins since the feature existed, previously checked
 *      only in the browser by app/premium/page.tsx. It is checked here against
 *      the email GoTrue returns for the validated token, before the PIN is even
 *      compared, so an account that is not on the list never learns anything
 *      about the PIN and cannot contribute to a guess.
 *
 *   3. `ADMIN_GRANT_PIN`. The same credential 202608190004 moved coin granting
 *      behind, compared in constant time. It is what separates "an account that
 *      is allowed to be here" from "the person holding it right now", because
 *      `profiles.is_admin` has to be set by hand in the SQL editor and the
 *      project chose not to depend on that (see the note in
 *      app/api/admin/verify-pin/route.ts).
 *
 * Everything privileged — statistics, user emails and phone numbers, bans, coin
 * grants, announcements, reports, the audit log — resolves its data through the
 * service role, which exists only in server environment variables. So this
 * function is the entire gate: pass it and the caller holds the key; fail it and
 * there is no route to the data at all, because every admin RPC is
 * EXECUTE-revoked from `anon` and `authenticated` and the tables behind them
 * have RLS enabled with no client policies.
 *
 * What that makes true, and worth stating plainly: hiding a button, guarding a
 * React route, or refusing to render a page here does NOT secure anything. This
 * function does. Every handler below calls it first, before it touches a body,
 * and before it creates a client.
 */

export type AdminContext = {
  /** The admin's own Supabase user id. Audit metadata, never authorization. */
  adminId: string;
  /** The admin's email, for display in the panel header. */
  adminEmail: string | null;
  /** Service-role client. Never leaves the server. */
  db: SupabaseClient;
};

export class AdminAuthError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** Set when the deployment is missing configuration rather than the caller being wrong. */
    readonly misconfigured = false
  ) {
    super(message);
    this.name = "AdminAuthError";
  }
}

/** Constant-time compare, so a wrong PIN takes the same time whatever it is. */
function pinMatches(supplied: string, expected: string): boolean {
  const a = Buffer.from(supplied, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * The PIN, from the header first and the body second.
 *
 * The header is the intended path: a credential in a request body ends up in
 * proxies' request logs and in browser network panels with the payload
 * expanded, and this one is worth keeping out of both. The body is still
 * accepted because app/api/admin/grant-coins predates the header and an older
 * deployed client must keep working through a release.
 */
function readPin(req: NextRequest, body?: unknown): string | null {
  const header = req.headers.get("x-admin-pin");
  if (header) return header;
  if (body && typeof body === "object" && "pin" in body) {
    const value = (body as { pin?: unknown }).pin;
    if (typeof value === "string") return value;
  }
  return null;
}

export function serviceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new AdminAuthError(
      "SUPABASE_SERVICE_ROLE_KEY or NEXT_PUBLIC_SUPABASE_URL is not set on the server.",
      500,
      true
    );
  }
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Verifies the caller is an admin. Throws `AdminAuthError` on any failure; the
 * shared `handleAdminError` helper turns that into the response shape every
 * other route in this app already returns.
 *
 * `body` is passed in when the handler has already parsed it, so the PIN can be
 * read from it without parsing twice.
 */
/**
 * Wrong-PIN counter, separate from the general request bucket.
 *
 * A single bucket cannot serve both purposes: a panel that legitimately issues
 * a few hundred requests in ten minutes as an admin browses it would have to be
 * allowed through at a rate that also makes a PIN guess nearly free. So
 * throughput is capped generously and *failures* are capped hard — 8 wrong PINs
 * per ten minutes per identity is far beyond a typo and far short of a search.
 *
 * Same per-instance caveat as lib/apiGuard.ts: this is a floor that stops a
 * single client, not a distributed ceiling. Vercel Firewall is the ceiling.
 */
const PIN_FAILURE_LIMIT = 8;
const PIN_FAILURE_WINDOW_MS = 10 * 60_000;
type FailureBucket = { count: number; windowStart: number };
const pinFailures = new Map<string, FailureBucket>();

function tooManyPinFailures(identities: string[]): boolean {
  const now = Date.now();
  if (pinFailures.size > 10_000) {
    for (const [key, bucket] of pinFailures) {
      if (now - bucket.windowStart > PIN_FAILURE_WINDOW_MS) pinFailures.delete(key);
    }
  }
  return identities.some((identity) => {
    const bucket = pinFailures.get(identity);
    return Boolean(bucket && now - bucket.windowStart < PIN_FAILURE_WINDOW_MS && bucket.count >= PIN_FAILURE_LIMIT);
  });
}

function recordPinFailure(identities: string[]) {
  const now = Date.now();
  for (const identity of identities) {
    const bucket = pinFailures.get(identity);
    if (!bucket || now - bucket.windowStart >= PIN_FAILURE_WINDOW_MS) {
      pinFailures.set(identity, { count: 1, windowStart: now });
    } else {
      bucket.count += 1;
    }
  }
}

function clearPinFailures(identities: string[]) {
  for (const identity of identities) pinFailures.delete(identity);
}

export async function requireAdmin(req: NextRequest, body?: unknown): Promise<AdminContext> {
  const ip = clientIp(req.headers);

  /* Rate-limited before any crypto or network work. Generous on purpose: this
     bucket exists to stop a scripted flood, not to pace an admin browsing the
     panel. The credential search is throttled by the failure counter below. */
  const limited = consumeMulti("admin-panel", [ip], 400, 10 * 60_000);
  if (limited) throw new RateLimited(limited);

  if (tooManyPinFailures([ip])) {
    throw new RateLimited({ retryAfterSeconds: Math.ceil(PIN_FAILURE_WINDOW_MS / 1000) });
  }

  const expectedPin = process.env.ADMIN_GRANT_PIN;
  if (!expectedPin) {
    /* Reported as a configuration error, not "incorrect PIN". An unset
       variable makes every comparison fail, and telling an admin their PIN is
       wrong sends them retyping something that can never succeed. */
    throw new AdminAuthError(
      "ADMIN_GRANT_PIN is not set on the server. Add it to the deployment environment and redeploy.",
      500,
      true
    );
  }

  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    throw new AdminAuthError("Not authenticated.", 401);
  }

  /* Validated against GoTrue rather than decoded. A decoded JWT proves nothing
     about who signed it. */
  const verifier = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
  const {
    data: { user },
    error,
  } = await verifier.auth.getUser(authHeader.slice("Bearer ".length));

  if (error || !user) {
    throw new AdminAuthError("Your session has expired. Sign in again.", 401);
  }

  const identities = [ip, user.id];
  if (tooManyPinFailures(identities)) {
    throw new RateLimited({ retryAfterSeconds: Math.ceil(PIN_FAILURE_WINDOW_MS / 1000) });
  }

  /* The allowlist, checked before the PIN and deliberately not counted as a PIN
     failure.

     It is the cheaper of the two checks, so putting it first means a wrong
     account is rejected without a timingSafeEqual and without touching the
     failure counter — otherwise every signed-in user on the internet could burn
     the real admin's eight-attempt budget by hammering this endpoint.

     403 rather than 401 because the account itself is valid; it is simply not
     one of the two that may open the panel. The distinction matters to the
     client: a 401 means "the PIN was wrong, try again", a 403 means "this will
     never work, stop asking". */
  if (!isAdminEmail(user.email, "server")) {
    throw new AdminAuthError("This account is not authorized to use the admin panel.", 403);
  }

  const pin = readPin(req, body);
  if (typeof pin !== "string" || !pinMatches(pin, expectedPin)) {
    recordPinFailure(identities);
    throw new AdminAuthError("Incorrect admin PIN.", 401);
  }

  clearPinFailures(identities);

  return {
    adminId: user.id,
    adminEmail: (user.email as string | undefined) ?? null,
    db: serviceClient(),
  };
}

/** Thrown for 429s so `requireAdmin` stays a single code path. */
export class RateLimited extends Error {
  constructor(readonly guard: Guard) {
    super("Too many requests.");
    this.name = "RateLimited";
  }
}

/** The standard error body, shaped like every other route in this app. */
export function handleAdminError(err: unknown, scope: string): Response {
  if (err instanceof RateLimited) return rateLimitedResponse(err.guard);

  if (err instanceof AdminAuthError) {
    return Response.json({ error: err.message, misconfigured: err.misconfigured }, { status: err.status });
  }

  console.error(`[${scope}]`, err);
  return Response.json({ error: "Server error." }, { status: 500 });
}

/**
 * One audit row per privileged action.
 *
 * Never awaited to the point of failing the request: the action has already
 * happened by the time this is called, and losing the request over a logging
 * write would be the wrong trade. It is awaited (not fire-and-forgotten) so a
 * serverless invocation cannot be frozen before the write lands, but a failure
 * is logged rather than thrown.
 *
 * `metadata` must stay free of secrets — no emails, no phone numbers, no
 * message bodies. Ids, amounts, statuses and reasons only.
 */
export async function logAdmin(
  db: SupabaseClient,
  adminId: string,
  action: string,
  targetUserId: string | null = null,
  metadata: Record<string, unknown> = {}
): Promise<void> {
  try {
    const { error } = await db.rpc("admin_log", {
      p_admin: adminId,
      p_action: action,
      p_target: targetUserId,
      p_meta: metadata,
    });
    if (error) console.error("[admin_log]", error.message);
  } catch (err) {
    console.error("[admin_log]", err);
  }
}

/**
 * The SQLSTATE the enforcement triggers raise (202609080001 §B2).
 *
 * Postgres user-defined classes start at 9; `WH` is not a real class, so this
 * cannot collide with a built-in code. Routes surface it as a 403 with one
 * sentence rather than the raw exception text.
 */
export const BAN_SQLSTATE = "WH001";
export const POLL_SQLSTATE = "WH002";

export const BANNED_MESSAGE = "Your account has been restricted from using Whisper.";

/** True when a Supabase/Postgres error is the ban trigger refusing a write. */
export function isBanRejection(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  if (error.code === BAN_SQLSTATE) return true;
  return /restricted from using Whisper/i.test(error.message ?? "");
}
