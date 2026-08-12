/**
 * The browser half of Whispers AI.
 *
 * This module is the only thing in the app that talks to the assistant, and it
 * talks to exactly one place: the `whispers-ai` Supabase Edge Function. There is
 * no Hugging Face URL, model name, or token anywhere in the client bundle —
 * those live in Supabase secrets and are read server-side only. If you ever find
 * yourself needing `HF_API_TOKEN` here, the design has gone wrong.
 *
 * The limits below mirror supabase/functions/whispers-ai/config.ts. They exist
 * so the composer can enforce a character count and trim history *before*
 * spending a round trip; the server re-checks every one of them and is the only
 * authority. Keep the two files in step — the server rejecting something the
 * client allowed is a bad error message, not a security hole.
 */

import { supabase } from "@/lib/supabase/client";

export const AI_LIMITS = {
  /** Matches MAX_QUESTION_CHARS server-side. */
  MAX_QUESTION_CHARS: 500,
  /** Matches MAX_HISTORY_MESSAGES server-side — turns, not exchanges. */
  MAX_HISTORY_MESSAGES: 6,
} as const;

/** Shown on first open. Mirrors QUICK_QUESTIONS in the function's knowledge.ts. */
export const QUICK_QUESTIONS = [
  "How do Whispers work?",
  "How do I send an anonymous message?",
  "How do coins work?",
  "How do I transfer coins?",
  "Where do I find my wallet address?",
  "How do I unlock a sender hint?",
  "How do I change my theme?",
] as const;

export type AiTurn = { role: "user" | "assistant"; content: string };

/** Safe, non-identifying hints about where the user is standing. Never carries
 *  a message, an email, a token, a balance, or an id. */
export type AiPageContext = { page?: string; section?: string };

export type AiErrorCode =
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
  | "unavailable"
  | "offline";

export type AiResult =
  | { ok: true; reply: string }
  | { ok: false; code: AiErrorCode; message: string; retryable: boolean; retryAfterSeconds?: number };

const FALLBACK_MESSAGE = "Whispers AI is temporarily unavailable. Please try again in a moment.";
const OFFLINE_MESSAGE = "You're offline. Reconnect and Whispers AI will pick up where you left off.";

type ServerBody = {
  ok?: boolean;
  reply?: unknown;
  code?: unknown;
  message?: unknown;
  retryable?: unknown;
  retryAfterSeconds?: unknown;
};

const ERROR_CODES: AiErrorCode[] = [
  "unauthenticated",
  "bad_request",
  "empty",
  "too_long",
  "rate_limited",
  "daily_limit",
  "in_flight",
  "timeout",
  "configuration_error",
  "provider_auth",
  "model_unavailable",
  "unavailable",
  "offline",
];

function asErrorCode(value: unknown): AiErrorCode {
  return typeof value === "string" && (ERROR_CODES as string[]).includes(value)
    ? (value as AiErrorCode)
    : "unavailable";
}

function toResult(body: ServerBody | null): AiResult {
  if (body?.ok === true && typeof body.reply === "string" && body.reply.trim()) {
    return { ok: true, reply: body.reply };
  }

  const code = asErrorCode(body?.code);

  return {
    ok: false,
    code,
    message: typeof body?.message === "string" && body.message ? body.message : FALLBACK_MESSAGE,
    // Default to retryable: a failure we can't classify is usually transient,
    // and offering the button is kinder than hiding it.
    retryable: typeof body?.retryable === "boolean" ? body.retryable : true,
    ...(typeof body?.retryAfterSeconds === "number"
      ? { retryAfterSeconds: body.retryAfterSeconds }
      : {}),
  };
}

/**
 * `functions.invoke` reports a non-2xx as an error whose `context` is the raw
 * `Response`. That body is our own structured payload, so it's worth reading —
 * without this, every server-side refusal collapses into one generic string and
 * the rate-limit and daily-limit messages never reach the user.
 */
async function bodyFromInvokeError(error: unknown): Promise<ServerBody | null> {
  const context = (error as { context?: unknown } | null)?.context;
  if (!context || typeof context !== "object") return null;

  const response = context as Response;
  if (typeof response.json !== "function") return null;

  try {
    return (await response.json()) as ServerBody;
  } catch {
    return null;
  }
}

/**
 * Trims the session transcript down to what the server will accept, so a long
 * conversation doesn't send tokens that are about to be discarded anyway.
 *
 * The window is cut to start on a user turn for the same reason the server does
 * it: a chat template handed an assistant message with no question in front of
 * it is a wasted request.
 */
export function trimHistory(turns: AiTurn[]): AiTurn[] {
  const tail = turns.slice(-AI_LIMITS.MAX_HISTORY_MESSAGES);
  while (tail.length > 0 && tail[0].role === "assistant") tail.shift();
  return tail;
}

/**
 * Asks Whispers AI one question.
 *
 * Never throws: every outcome — offline, refused, rate-limited, upstream down —
 * comes back as an `AiResult` so the caller has one shape to render.
 */
export async function askWhispersAi(input: {
  message: string;
  history?: AiTurn[];
  context?: AiPageContext;
}): Promise<AiResult> {
  const message = input.message.trim();

  /* Two checks the server would also make, done here purely to avoid a pointless
     round trip (and, for the empty case, a pointless model call). */
  if (!message) {
    return {
      ok: false,
      code: "empty",
      message: "Type a question and Whispers AI will help.",
      retryable: false,
    };
  }

  if (message.length > AI_LIMITS.MAX_QUESTION_CHARS) {
    return {
      ok: false,
      code: "too_long",
      message: `Keep it under ${AI_LIMITS.MAX_QUESTION_CHARS} characters so Whispers AI can answer properly.`,
      retryable: false,
    };
  }

  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return { ok: false, code: "offline", message: OFFLINE_MESSAGE, retryable: true };
  }

  try {
    const { data, error } = await supabase.functions.invoke("whispers-ai", {
      body: {
        message,
        history: trimHistory(input.history ?? []),
        ...(input.context && Object.keys(input.context).length > 0
          ? { context: input.context }
          : {}),
      },
    });

    if (error) return toResult(await bodyFromInvokeError(error));

    return toResult(data as ServerBody | null);
  } catch {
    /* A network-level failure. No detail is surfaced deliberately — there is
       nothing here a user can act on, and the server log has the real story. */
    return { ok: false, code: "unavailable", message: FALLBACK_MESSAGE, retryable: true };
  }
}
