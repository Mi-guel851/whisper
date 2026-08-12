/**
 * Whispers AI — the server side of the in-app assistant.
 *
 * Request flow, in order, and the order matters because each step is cheaper
 * than the one after it:
 *
 *   1. CORS preflight / method check          — no work
 *   2. Secrets present?                       — no work
 *   3. Body shape, length, emptiness          — no network
 *   4. Authenticated user from the JWT        — one auth round trip
 *   5. In-memory burst + duplicate guard      — no network
 *   6. Durable per-user rate limit            — one RPC
 *   7. Hugging Face chat completion           — the expensive one
 *
 * An empty question, an oversized question, an unauthenticated caller or a
 * rate-limited one therefore never reaches Hugging Face, which is the whole
 * point: the account behind `HF_API_TOKEN` has a finite allowance.
 *
 * The token itself is read from `Deno.env` here and passed only to
 * `askHuggingFace`. It is never returned, logged, or attached to an error.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

import { MESSAGES } from "./config.ts";
import { answerOffTopic, buildSystemPrompt } from "./knowledge.ts";
import { askHuggingFace, readHfConfig } from "./huggingface.ts";
import { checkDurable, checkLocal, releaseLocal } from "./rateLimit.ts";
import { parseRequest } from "./validate.ts";

/* Injected by the Supabase Edge Runtime — the same three the existing
   notify-* functions rely on. Nothing here is a project secret we manage. */
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

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
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS_HEADERS,
      ...extraHeaders,
      "Content-Type": "application/json",
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
      retryable: code !== "empty" && code !== "too_long" && code !== "unauthenticated",
    },
    retryAfterSeconds ? { "Retry-After": String(retryAfterSeconds) } : {}
  );
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (req.method !== "POST") {
    return fail(405, "bad_request", MESSAGES.BAD_REQUEST);
  }

  /* Step 2 — a missing secret is an operator problem, not a user problem, so it
     reads as "temporarily unavailable" and says which name is missing in the
     server log only. */
  const hf = readHfConfig();
  if (!hf) return fail(503, "unavailable", MESSAGES.UNAVAILABLE);

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.error("[whispers-ai] SUPABASE_URL / SUPABASE_ANON_KEY are not available.");
    return fail(503, "unavailable", MESSAGES.UNAVAILABLE);
  }

  /* Step 3 — parse before authenticating: an unparseable body is the cheapest
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

  /* Step 4 — the identity. Taken from the JWT the caller presented and verified
     by Supabase Auth; a `userId` in the request body would be ignored (see
     validate.ts). There is no unauthenticated path past this point. */
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.toLowerCase().startsWith("bearer ")) {
    return fail(401, "unauthenticated", MESSAGES.UNAUTHENTICATED);
  }

  const accessToken = authHeader.slice(7).trim();
  if (!accessToken) return fail(401, "unauthenticated", MESSAGES.UNAUTHENTICATED);

  const authClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userData, error: userError } = await authClient.auth.getUser(accessToken);
  const user = userData?.user;

  if (userError || !user) {
    return fail(401, "unauthenticated", MESSAGES.UNAUTHENTICATED);
  }

  /* Step 5 — burst and duplicate-request guard, in this isolate's memory. */
  const local = checkLocal(user.id);
  if (!local.allowed) {
    if (local.reason === "in_flight") {
      return fail(409, "in_flight", MESSAGES.IN_FLIGHT);
    }
    return fail(429, "rate_limited", MESSAGES.RATE_LIMITED, local.retryAfterSeconds);
  }

  try {
    /* Step 6 — the durable limit. Uses the service-role key so the counter
       table stays unreachable from the browser; the user id comes from the
       verified token above, never from the request. Degrades to a no-op if the
       migration hasn't been applied. */
    if (SUPABASE_SERVICE_ROLE_KEY) {
      const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
      });

      const durable = await checkDurable(admin, user.id);
      if (!durable.allowed) {
        return durable.scope === "day"
          ? fail(429, "daily_limit", MESSAGES.DAILY_LIMIT, durable.retryAfterSeconds)
          : fail(429, "rate_limited", MESSAGES.RATE_LIMITED, durable.retryAfterSeconds);
      }
    }

    const offTopic = answerOffTopic(parsed.question);
    if (offTopic) return json(200, { ok: true, reply: offTopic });

    /* Step 7 — the model. */
    const systemPrompt = buildSystemPrompt(parsed.question, parsed.context);
    const outcome = await askHuggingFace(hf, systemPrompt, parsed.history, parsed.question);

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
    if (outcome.kind === "provider_unavailable") {
      return fail(503, "unavailable", MESSAGES.UNAVAILABLE);
    }

    console.info(`[whispers-ai] Hugging Face completed chat request with model ${outcome.model}.`);
    return json(200, { ok: true, reply: outcome.reply });
  } catch (cause) {
    /* Anything unforeseen still leaves as the same friendly line. The detail
       goes to the function log, where only the project owner can read it. */
    console.error("[whispers-ai] unhandled failure:", cause);
    return fail(500, "unavailable", MESSAGES.UNAVAILABLE);
  } finally {
    /* Must run on every path, or the duplicate-request guard turns into a lock
       the user can't clear. */
    releaseLocal(user.id);
  }
});
