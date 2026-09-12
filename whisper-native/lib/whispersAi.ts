import { apiBase } from "./feed";
import { supabase } from "./supabase";

/**
 * The native half of Whispers AI.
 *
 * A DIRECT PORT of the web app's `lib/ai/whispersAi.ts`. One endpoint, and it is
 * our own route: `POST /api/whispers-ai` on the deployment. There is no Gemini
 * URL, model name or API key anywhere in this bundle — those live in the server's
 * environment and are read only inside `lib/ai/server/gemini.ts` there. Needing
 * `GEMINI_API_KEY` here would mean the design had gone wrong.
 *
 * The limits mirror `lib/ai/server/config.ts`. They exist so the screen can
 * enforce a character count and trim history *before* spending a round trip; the
 * server re-checks every one of them and is the only authority. The server
 * refusing something the client allowed is a bad error message, not a hole.
 */

export const AI_LIMITS = {
  /** Matches MAX_QUESTION_CHARS server-side. */
  MAX_QUESTION_CHARS: 500,
  /** Matches MAX_HISTORY_MESSAGES server-side — turns, not exchanges. */
  MAX_HISTORY_MESSAGES: 6,
} as const;

/** Shown on first open. Mirrors QUICK_QUESTIONS in lib/ai/server/knowledge.ts. */
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

/** Safe, non-identifying hints about where the user is standing. Never carries a
 *  message, an email, a token, a balance, or an id. */
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
  | "blocked"
  | "unavailable"
  | "offline";

export type AiResult =
  | { ok: true; reply: string }
  | { ok: false; code: AiErrorCode; message: string; retryable: boolean; retryAfterSeconds?: number };

const FALLBACK_MESSAGE = "Whispers AI is temporarily unavailable. Please try again in a moment.";

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
  "blocked",
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
    /* Default to retryable: a failure we cannot classify is usually transient, and
       offering the button is kinder than hiding it. */
    retryable: typeof body?.retryable === "boolean" ? body.retryable : true,
    ...(typeof body?.retryAfterSeconds === "number"
      ? { retryAfterSeconds: body.retryAfterSeconds }
      : {}),
  };
}

/**
 * Reads the envelope off a response, whatever its status.
 *
 * Both halves matter. A non-2xx from our own route still carries a structured
 * body, and without reading it every server-side refusal would collapse into one
 * generic string — the rate-limit and daily-limit messages would never reach the
 * user. And a response that is not our JSON (a platform timeout page, a captive
 * portal) must not throw; it becomes `null`, which `toResult` renders as the
 * generic fallback.
 */
async function readBody(response: Response): Promise<ServerBody | null> {
  try {
    return (await response.json()) as ServerBody;
  } catch {
    return null;
  }
}

/**
 * Trims the transcript down to what the server will accept, so a long
 * conversation does not send tokens that are about to be discarded anyway.
 *
 * The window is cut to start on a user turn for the same reason the server does
 * it: a chat template handed an assistant message with no question in front of it
 * is a wasted request.
 */
export function trimHistory(turns: AiTurn[]): AiTurn[] {
  const tail = turns.slice(-AI_LIMITS.MAX_HISTORY_MESSAGES);
  while (tail.length > 0 && tail[0].role === "assistant") tail.shift();
  return tail;
}

/**
 * Asks Whispers AI one question.
 *
 * Never throws: every outcome — refused, rate-limited, upstream down, signed out
 * — comes back as an `AiResult`, so the screen has one shape to render.
 */
export async function askWhispersAi(input: {
  message: string;
  history?: AiTurn[];
  context?: AiPageContext;
}): Promise<AiResult> {
  const message = input.message.trim();

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

  try {
    /* The access token has to be attached by hand — a plain fetch to our own
       route does not carry it, and without the header the route cannot identify
       the caller and answers 401. */
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const accessToken = session?.access_token;

    if (!accessToken) {
      return {
        ok: false,
        code: "unauthenticated",
        message: "Sign in to Whisper to chat with Whispers AI.",
        retryable: false,
      };
    }

    const response = await fetch(`${apiBase()}/api/whispers-ai`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        message,
        history: trimHistory(input.history ?? []),
        ...(input.context && Object.keys(input.context).length > 0
          ? { context: input.context }
          : {}),
      }),
    });

    return toResult(await readBody(response));
  } catch {
    /* A network-level failure. No detail is surfaced deliberately — there is
       nothing here a user can act on, and the server log has the real story. */
    return { ok: false, code: "unavailable", message: FALLBACK_MESSAGE, retryable: true };
  }
}
