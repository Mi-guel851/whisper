/**
 * Whispers AI — the server side of the in-app assistant.
 *
 * This route replaces the `whispers-ai` Supabase Edge Function. It lives here
 * because that is where the API key can live: `GEMINI_API_KEY` is a Vercel
 * project environment variable, and Vercel variables are visible to Next.js
 * server code, not to Supabase Edge Functions (those read Supabase secrets, a
 * separate store). The Android/iOS shells load this same deployment through
 * Capacitor's `server.url`, so one origin serves web and native and a relative
 * `fetch("/api/whispers-ai")` works everywhere.
 *
 * Request flow, in order, and the order matters because each step is cheaper
 * than the one after it:
 *
 *   1. Key present?                           — no work
 *   2. Body shape, length, emptiness          — no network
 *   3. Authenticated user from the JWT        — one auth round trip
 *   4. In-memory burst + duplicate guard      — no network
 *   5. Durable per-user rate limit            — one RPC
 *   6. Local scope gate                       — no network
 *   7. Gemini generateContent                 — the expensive one
 *
 * An empty question, an oversized question, an unauthenticated caller, a
 * rate-limited one, or an obviously off-topic one therefore never reaches
 * Gemini — which is the whole point: the key has a finite allowance.
 *
 * The key is read inside `readGeminiConfig()` and passed only to `askGemini`. It
 * is never returned, logged, or attached to an error.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

import { MESSAGES } from "@/lib/ai/server/config";
import {
  buildSystemPrompt,
  classifyScope,
  isRefusal,
  OFF_TOPIC_REPLY,
  SCOPE_SENTINEL,
} from "@/lib/ai/server/knowledge";
import { askGemini, readGeminiConfig } from "@/lib/ai/server/gemini";
import { checkDurable, checkLocal, releaseLocal } from "@/lib/ai/server/rateLimit";
import { parseRequest } from "@/lib/ai/server/validate";

/** Node, not Edge: the Supabase client and `process.env` both behave normally
 *  here, and this route is never latency-critical enough to need the edge. */
export const runtime = "nodejs";

/**
 * Longer than Vercel's 10s default for Node functions.
 *
 * It has to exceed `LIMITS.GEMINI_TIMEOUT_MS` (20s) with room to spare. If the
 * platform kills the invocation first, the browser gets Vercel's own gateway
 * error page instead of our JSON, and every friendly message below is bypassed —
 * the user sees a raw failure. Our AbortController must always fire first.
 */
export const maxDuration = 30;

type ErrorCode =
  | "unauthenticated"
  | "bad_request"
  | "empty"
  | "too_long"
  | "rate_limited"
  | "daily_limit"
  | "in_flight"
  | "timeout"
  | "configuration_error"
  | "provider_auth"
  | "model_unavailable"
  | "blocked"
  | "unavailable";

/**
 * Every response — success or failure — is this one shape, so the client has a
 * single thing to parse. `retryAfterSeconds` is present only where waiting
 * actually helps.
 */
function json(
  status: number,
  body: Record<string, unknown>,
  extraHeaders: Record<string, string> = {}
) {
  return NextResponse.json(body, {
    status,
    headers: {
      ...extraHeaders,
      // A cached assistant answer would be both wrong and a privacy problem.
      "Cache-Control": "no-store",
    },
  });
}

function fail(status: number, code: ErrorCode, message: string, retryAfterSeconds?: number) {
  return json(
    status,
    {
      ok: false,
      code,
      message,
      ...(retryAfterSeconds ? { retryAfterSeconds } : {}),
      /* `retryable` tells the UI whether to offer its Retry button, so the
         decision lives with the server that knows why the call failed. */
      retryable:
        code !== "empty" &&
        code !== "too_long" &&
        code !== "unauthenticated" &&
        code !== "blocked",
    },
    retryAfterSeconds ? { "Retry-After": String(retryAfterSeconds) } : {}
  );
}

export async function POST(req: NextRequest) {
  /* Step 1 — a missing key is an operator problem, not a user problem, so it
     reads as "not configured yet" and names the variable in the server log only.
     Done first because it is free and because every later step is wasted without
     it. */
  const gemini = readGeminiConfig();
  if (!gemini) return fail(503, "configuration_error", MESSAGES.CONFIGURATION);

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !anonKey) {
    console.error(
      "[whispers-ai] NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY are not set on the server."
    );
    return fail(503, "unavailable", MESSAGES.UNAVAILABLE);
  }

  /* Step 2 — parse before authenticating: an unparseable body is the cheapest
     thing to reject, and there's nothing to leak either way. */
  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return fail(400, "bad_request", MESSAGES.BAD_REQUEST);
  }

  const parsed = parseRequest(rawBody);
  if ("code" in parsed) {
    if (parsed.code === "empty") return fail(400, "empty", MESSAGES.EMPTY);
    if (parsed.code === "too_long") return fail(400, "too_long", MESSAGES.TOO_LONG);
    return fail(400, "bad_request", MESSAGES.BAD_REQUEST);
  }

  /* Step 3 — the identity. Taken from the JWT the caller presented and verified
     by Supabase Auth; a `userId` in the request body would be ignored (see
     validate.ts). There is no unauthenticated path past this point. */
  const authHeader = req.headers.get("authorization") ?? "";
  if (!authHeader.toLowerCase().startsWith("bearer ")) {
    return fail(401, "unauthenticated", MESSAGES.UNAUTHENTICATED);
  }

  const accessToken = authHeader.slice(7).trim();
  if (!accessToken) return fail(401, "unauthenticated", MESSAGES.UNAUTHENTICATED);

  const authClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userData, error: userError } = await authClient.auth.getUser(accessToken);
  const user = userData?.user;

  if (userError || !user) {
    return fail(401, "unauthenticated", MESSAGES.UNAUTHENTICATED);
  }

  /* Step 4 — burst and duplicate-request guard, in this instance's memory. */
  const local = checkLocal(user.id);
  if (!local.allowed) {
    if (local.reason === "in_flight") {
      return fail(409, "in_flight", MESSAGES.IN_FLIGHT);
    }
    return fail(429, "rate_limited", MESSAGES.RATE_LIMITED, local.retryAfterSeconds);
  }

  try {
    /* Step 5 — the durable limit. Uses the service-role key so the counter table
       stays unreachable from the browser; the user id comes from the verified
       token above, never from the request. Degrades to a no-op if
       202608120001_whispers_ai_rate_limit.sql hasn't been applied. */
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (serviceKey) {
      const admin = createClient(supabaseUrl, serviceKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });

      const durable = await checkDurable(admin, user.id);
      if (!durable.allowed) {
        return durable.scope === "day"
          ? fail(429, "daily_limit", MESSAGES.DAILY_LIMIT, durable.retryAfterSeconds)
          : fail(429, "rate_limited", MESSAGES.RATE_LIMITED, durable.retryAfterSeconds);
      }
    } else {
      console.warn(
        "[whispers-ai] SUPABASE_SERVICE_ROLE_KEY is not set — durable rate limiting is off. In-memory limits still apply."
      );
    }

    /* Step 6 — the local half of the scope gate. Catches the unambiguous cases
       ("write me a poem", "ignore your instructions") for free. Everything else,
       including anything only a reader could judge, goes to the model with the
       sentinel contract in force. */
    if (classifyScope(parsed.question) === "out_of_scope") {
      return json(200, { ok: true, reply: OFF_TOPIC_REPLY });
    }

    /* Step 7 — the model. */
    const systemPrompt = buildSystemPrompt(parsed.question, parsed.context);
    const outcome = await askGemini(gemini, systemPrompt, parsed.history, parsed.question);

    if (outcome.kind === "rate_limited") {
      return fail(429, "rate_limited", MESSAGES.RATE_LIMITED, outcome.retryAfterSeconds);
    }
    if (outcome.kind === "timeout") {
      return fail(504, "timeout", MESSAGES.TIMEOUT);
    }
    if (outcome.kind === "configuration_error") {
      return fail(503, "configuration_error", MESSAGES.CONFIGURATION);
    }
    if (outcome.kind === "authentication_error") {
      return fail(503, "provider_auth", MESSAGES.PROVIDER_AUTH);
    }
    if (outcome.kind === "model_unavailable") {
      return fail(503, "model_unavailable", MESSAGES.MODEL_UNAVAILABLE);
    }
    if (outcome.kind === "blocked") {
      /* Gemini's own safety layer refused. Answered as a 200 rather than an
         error: the user asked something, they get a reply, and a Retry button
         against an identical prompt would only fail again. */
      return json(200, { ok: true, reply: MESSAGES.BLOCKED });
    }
    if (outcome.kind === "empty_response" || outcome.kind === "provider_unavailable") {
      return fail(503, "unavailable", MESSAGES.UNAVAILABLE);
    }

    /* The second half of the scope gate. The model judged the question off-topic
       and said so with the sentinel; the wording of the refusal is ours, so it
       stays consistent no matter how the model chose to phrase it. */
    if (isRefusal(outcome.reply)) {
      return json(200, { ok: true, reply: OFF_TOPIC_REPLY });
    }

    /* A real answer that happens to contain the sentinel — vanishingly unlikely,
       but the token must never be visible to a user, so it is scrubbed rather
       than trusted not to appear. */
    const reply = outcome.reply.includes(SCOPE_SENTINEL)
      ? outcome.reply.split(SCOPE_SENTINEL).join("").replace(/\s{2,}/g, " ").trim()
      : outcome.reply;

    if (!reply) return json(200, { ok: true, reply: OFF_TOPIC_REPLY });

    return json(200, { ok: true, reply });
  } catch (cause) {
    /* Anything unforeseen still leaves as the same friendly line. The detail goes
       to the Vercel function log, where only the project owner can read it. */
    console.error("[whispers-ai] unhandled failure:", cause);
    return fail(500, "unavailable", MESSAGES.UNAVAILABLE);
  } finally {
    /* Must run on every path, or the duplicate-request guard turns into a lock
       the user can't clear. */
    releaseLocal(user.id);
  }
}

/** A GET here is almost always a browser or a probe, not the app. Answered
 *  explicitly so it shows up as a 405 in the logs rather than a 404 that looks
 *  like the route failed to deploy. */
export function GET() {
  return fail(405, "bad_request", MESSAGES.BAD_REQUEST);
}
