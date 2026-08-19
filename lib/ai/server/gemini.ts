/**
 * The Gemini call — the only place in this repository that touches the API key.
 *
 * `GEMINI_API_KEY` is read from the server environment (Vercel project
 * environment variables in production, `.env.local` in development) at request
 * time. It is never placed in a response body, a thrown error, or a log line:
 * the failure taxonomy below deliberately maps upstream status codes onto opaque
 * outcome names, so the worst a caller can learn is "unavailable".
 *
 * The key travels in the `x-goog-api-key` header rather than the `?key=` query
 * parameter Google's quickstarts use. Same authentication, but a query string
 * ends up in access logs, proxy traces and error reports, and a key that leaks
 * that way leaks quietly.
 *
 * Endpoint contract (Generative Language API v1beta):
 *   POST /v1beta/models/{model}:generateContent
 *   { system_instruction, contents[], generationConfig, safetySettings[] }
 *   -> { candidates[0].content.parts[].text, candidates[0].finishReason,
 *        promptFeedback.blockReason, usageMetadata }
 */

import { DEFAULT_GEMINI_MODEL, geminiEndpoint, LIMITS } from "./config";
import type { ChatTurn } from "./validate";

export type GeminiOutcome =
  | { kind: "ok"; reply: string; model: string }
  /** The provider's own safety layer refused, either the prompt or the answer. */
  | { kind: "blocked" }
  /** A 200 with no usable text in it — see the note on `thinkingConfig` below. */
  | { kind: "empty_response" }
  | { kind: "rate_limited"; retryAfterSeconds: number }
  | { kind: "timeout" }
  | { kind: "configuration_error" }
  | { kind: "authentication_error" }
  | { kind: "model_unavailable" }
  | { kind: "provider_unavailable" };

/* --------------------------------------------------------------------------
 * Response shapes — only the fields we actually read
 * ------------------------------------------------------------------------ */

type GeminiPart = { text?: unknown; thought?: boolean };

type GeminiCandidate = {
  content?: { parts?: GeminiPart[]; role?: string };
  finishReason?: string;
};

type GeminiResponse = {
  candidates?: GeminiCandidate[];
  promptFeedback?: { blockReason?: string };
  error?: { code?: number; message?: string; status?: string };
};

/** Finish reasons that mean "the provider refused", not "the answer ended". */
const REFUSAL_REASONS = new Set([
  "SAFETY",
  "PROHIBITED_CONTENT",
  "BLOCKLIST",
  "SPII",
  "RECITATION",
  "IMAGE_SAFETY",
]);

/* --------------------------------------------------------------------------
 * Reply cleanup
 * ------------------------------------------------------------------------ */

/**
 * Removes the scaffolding some models leak into their output — a visible
 * reasoning preamble, or a stray chat-template control token. Gemini is
 * well-behaved about both, but this costs nothing and the alternative is the
 * assistant appearing to talk to itself in front of a user.
 */
function stripArtifacts(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<\|[a-z_]+\|>/gi, "")
    .trim();
}

/**
 * Trims a reply that ran into the token ceiling back to its last complete
 * sentence, so the user gets a short answer rather than a severed one.
 */
function tidyTail(text: string, truncated: boolean): string {
  if (!truncated) return text;

  const lastBreak = Math.max(
    text.lastIndexOf(". "),
    text.lastIndexOf(".\n"),
    text.lastIndexOf("!"),
    text.lastIndexOf("?"),
    text.lastIndexOf("\n")
  );

  // Only trim if there's a sensible amount of answer left after doing so.
  if (lastBreak > text.length * 0.5) return text.slice(0, lastBreak + 1).trim();
  return text;
}

/**
 * How long to tell the client to wait after a 429.
 *
 * Gemini rarely sends `Retry-After`; it puts the delay in the error body as a
 * `google.rpc.RetryInfo` detail (`{ retryDelay: "27s" }`). Both are read, the
 * header first, and anything absurd is clamped — a provider asking us to hold
 * for an hour is not something to pass through to a support chat.
 */
function retryAfterFrom(response: Response, body: string): number {
  const header = response.headers.get("retry-after");
  const parsedHeader = header ? Number.parseInt(header, 10) : Number.NaN;
  if (Number.isFinite(parsedHeader) && parsedHeader > 0) return Math.min(parsedHeader, 600);

  const match = body.match(/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/);
  if (match) {
    const seconds = Math.ceil(Number.parseFloat(match[1]));
    if (Number.isFinite(seconds) && seconds > 0) return Math.min(seconds, 600);
  }

  return 60;
}

/* --------------------------------------------------------------------------
 * Configuration
 * ------------------------------------------------------------------------ */

export type GeminiConfig = { apiKey: string; model: string };

/**
 * Environment variable names accepted for the key, in priority order.
 *
 * `GEMINI_API_KEY` is what the setup notes tell you to add. The other two are
 * the names Google's own SDKs read, and accepting them means a key added under a
 * remembered name works instead of producing a "not configured" message that
 * looks identical to having added nothing at all.
 */
const KEY_VARIABLES = [
  "GEMINI_API_KEY",
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "GOOGLE_API_KEY",
] as const;

/**
 * Accepts a Gemini model id and nothing else.
 *
 * Deliberately not a prefix check on the key or a whitelist of model names:
 * Google ships new ids continuously, and a whitelist would turn "try the newer
 * model" into a code change. This only rejects values that couldn't be a model
 * id at all — a full URL, a shell fragment, a path.
 */
function sanitizeModel(value: string | undefined): string | null {
  let model = value?.trim();
  if (!model) return null;

  // `models/gemini-2.5-flash` is how the API names them in responses; accept it
  // and normalise, because it is an easy thing to paste in.
  if (model.startsWith("models/")) model = model.slice("models/".length);

  if (!/^[A-Za-z0-9][A-Za-z0-9.\-_]{0,63}$/.test(model)) return null;
  return model;
}

/**
 * Reads the key and model from the environment.
 *
 * Returns null — and logs a variable *name*, never a value — when the key is
 * missing, so the caller can answer "not configured yet" instead of calling
 * Google without credentials and turning a setup mistake into a 400.
 */
export function readGeminiConfig(): GeminiConfig | null {
  let apiKey: string | undefined;
  let foundIn: string | undefined;

  for (const name of KEY_VARIABLES) {
    const raw = process.env[name];
    if (!raw) continue;
    /* Strip wrapping quotes. Pasting `"AQ.xxx"` into a dashboard field is a
       common slip, and the resulting 400 from Google says only "API key not
       valid", which sends you looking at the key instead of the quotes. */
    const cleaned = raw.trim().replace(/^["']|["']$/g, "").trim();
    if (!cleaned) continue;
    apiKey = cleaned;
    foundIn = name;
    break;
  }

  if (!apiKey) {
    console.error(
      "[whispers-ai] missing environment variable: GEMINI_API_KEY. Add it in Vercel (Project → Settings → Environment Variables) and redeploy, or to .env.local for local development."
    );
    return null;
  }

  if (foundIn !== KEY_VARIABLES[0]) {
    console.warn(
      `[whispers-ai] using ${foundIn} for the Gemini key. GEMINI_API_KEY is the documented name — consider renaming it.`
    );
  }

  if (/\s/.test(apiKey)) {
    console.error(
      "[whispers-ai] the Gemini key contains whitespace. It was probably pasted with a line break; re-copy it as a single line."
    );
    return null;
  }

  const configuredModel = process.env.GEMINI_CHAT_MODEL;
  const model = sanitizeModel(configuredModel) ?? DEFAULT_GEMINI_MODEL;

  if (configuredModel?.trim() && !sanitizeModel(configuredModel)) {
    console.error(
      `[whispers-ai] GEMINI_CHAT_MODEL is not a valid model id. Falling back to ${DEFAULT_GEMINI_MODEL}.`
    );
  }

  return { apiKey, model };
}

/* --------------------------------------------------------------------------
 * The call
 * ------------------------------------------------------------------------ */

/**
 * Whether this model lets thinking be switched off entirely.
 *
 * This matters more than it looks. On the 2.5 family, thinking tokens are billed
 * against `maxOutputTokens` — so a model left to think freely can spend the
 * entire budget reasoning and return `finishReason: MAX_TOKENS` with **no text
 * parts at all**. For a support assistant answering "how do I transfer coins?"
 * that is pure cost and pure latency for no answer.
 *
 * `thinkingBudget: 0` turns it off, but only Flash and Flash-Lite accept 0 —
 * Pro rejects it (its minimum is 128) with a 400, so the field is omitted for
 * anything that isn't clearly one of those two. Unknown model ids get nothing,
 * which is the safe direction: worst case we pay for thinking, rather than every
 * request failing.
 */
function canDisableThinking(model: string): boolean {
  const id = model.toLowerCase();
  if (id.includes("pro")) return false;
  return id.includes("2.5-flash") || id.includes("flash-lite") || id === "gemini-flash-latest";
}

/**
 * Safety settings.
 *
 * Loosened to `BLOCK_ONLY_HIGH` from Gemini's defaults on purpose. Whisper is an
 * anonymous-messaging app, so its support questions are legitimately about
 * harassment — "someone sent me a threatening whisper, what do I do?" is exactly
 * the question this assistant most needs to answer, and at the default
 * thresholds it is the kind of question that gets refused. High-confidence harm
 * is still blocked, and the scope gate in knowledge.ts is what actually keeps
 * the conversation on Whisper.
 */
const SAFETY_SETTINGS = [
  { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_ONLY_HIGH" },
  { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_ONLY_HIGH" },
  { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_ONLY_HIGH" },
  { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_ONLY_HIGH" },
] as const;

export async function askGemini(
  config: GeminiConfig,
  systemPrompt: string,
  history: ChatTurn[],
  question: string
): Promise<GeminiOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LIMITS.GEMINI_TIMEOUT_MS);

  /* Gemini's roles are `user` and `model` — it has no `assistant`, and no
     `system` role either: the system prompt is its own top-level field. */
  const contents = [
    ...history.map((turn) => ({
      role: turn.role === "assistant" ? "model" : "user",
      parts: [{ text: turn.content }],
    })),
    { role: "user", parts: [{ text: question }] },
  ];

  try {
    const response = await fetch(geminiEndpoint(config.model), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": config.apiKey,
      },
      signal: controller.signal,
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents,
        generationConfig: {
          temperature: LIMITS.TEMPERATURE,
          topP: LIMITS.TOP_P,
          maxOutputTokens: LIMITS.MAX_RESPONSE_TOKENS,
          candidateCount: 1,
          ...(canDisableThinking(config.model)
            ? { thinkingConfig: { thinkingBudget: 0 } }
            : {}),
        },
        safetySettings: SAFETY_SETTINGS,
      }),
    });

    if (!response.ok) {
      /* Read a little of the body for the server log. It can contain Google's
         own message but never our key — and it never leaves this process. */
      const detail = (await response.text().catch(() => "")).slice(0, 500);

      if (response.status === 429) {
        console.warn("[whispers-ai] Gemini rate limited the request (quota exhausted for this key).");
        return { kind: "rate_limited", retryAfterSeconds: retryAfterFrom(response, detail) };
      }

      if (response.status === 401) {
        console.error("[whispers-ai] Gemini rejected the credentials. Check GEMINI_API_KEY.");
        return { kind: "authentication_error" };
      }

      if (response.status === 403) {
        console.error(
          `[whispers-ai] Gemini returned PERMISSION_DENIED. The key is probably restricted, or the Generative Language API is not enabled for its project: ${detail}`
        );
        return { kind: "authentication_error" };
      }

      if (response.status === 400) {
        /* 400 covers two very different faults: a malformed request (our bug)
           and an unusable key (a setup problem). They need different fixes, so
           they get different log lines and different outcomes. */
        if (/api[_ ]?key/i.test(detail)) {
          console.error(
            "[whispers-ai] Gemini says the API key is not valid. Re-copy it from Google AI Studio and update GEMINI_API_KEY."
          );
          return { kind: "authentication_error" };
        }
        console.error(`[whispers-ai] Gemini rejected the request body for model ${config.model}: ${detail}`);
        return { kind: "model_unavailable" };
      }

      if (response.status === 404) {
        console.error(
          `[whispers-ai] Gemini has no model named ${config.model} on v1beta — check GEMINI_CHAT_MODEL.`
        );
        return { kind: "model_unavailable" };
      }

      if (response.status === 504) {
        console.warn("[whispers-ai] Gemini reported DEADLINE_EXCEEDED.");
        return { kind: "timeout" };
      }

      if (response.status >= 500) {
        console.error(`[whispers-ai] Gemini server failure ${response.status}: ${detail}`);
        return { kind: "provider_unavailable" };
      }

      console.error(`[whispers-ai] Gemini returned ${response.status}: ${detail}`);
      return { kind: "provider_unavailable" };
    }

    const payload = (await response.json().catch(() => null)) as GeminiResponse | null;

    if (!payload) {
      console.error("[whispers-ai] Gemini returned a body that isn't JSON.");
      return { kind: "provider_unavailable" };
    }

    // A blocked *prompt* comes back as a 200 with no candidates at all.
    const promptBlock = payload.promptFeedback?.blockReason;
    if (promptBlock) {
      console.warn(`[whispers-ai] Gemini blocked the prompt: ${promptBlock}`);
      return { kind: "blocked" };
    }

    const candidate = payload.candidates?.[0];
    const finishReason = candidate?.finishReason ?? "";

    /* `thought: true` marks a reasoning part. We never ask for those, but if a
       future model returns them they must not be shown to the user. */
    const text = (candidate?.content?.parts ?? [])
      .filter((part) => part.thought !== true && typeof part.text === "string")
      .map((part) => part.text as string)
      .join("")
      .trim();

    if (!text) {
      if (REFUSAL_REASONS.has(finishReason)) {
        console.warn(`[whispers-ai] Gemini stopped without an answer: ${finishReason}`);
        return { kind: "blocked" };
      }
      if (finishReason === "MAX_TOKENS") {
        /* Only reachable on a model where thinking can't be switched off — the
           budget went entirely on reasoning. Raising MAX_RESPONSE_TOKENS or
           pinning GEMINI_CHAT_MODEL to a Flash id fixes it. */
        console.error(
          `[whispers-ai] Gemini hit MAX_TOKENS before emitting any text on ${config.model}. Thinking consumed the whole output budget.`
        );
        return { kind: "empty_response" };
      }
      console.error(
        `[whispers-ai] Gemini returned no text (finishReason: ${finishReason || "none"}).`
      );
      return { kind: "empty_response" };
    }

    const cleaned = tidyTail(stripArtifacts(text), finishReason === "MAX_TOKENS").slice(
      0,
      LIMITS.MAX_REPLY_CHARS
    );

    if (!cleaned) {
      console.error("[whispers-ai] Gemini's reply was empty after cleanup.");
      return { kind: "empty_response" };
    }

    return { kind: "ok", reply: cleaned, model: config.model };
  } catch (cause) {
    /* `instanceof DOMException` is unreliable across runtimes, and on Node the
       abort surfaces as a DOMException-shaped Error. The name is the portable
       signal; the signal's own flag is the belt-and-braces check. */
    if (controller.signal.aborted || (cause instanceof Error && cause.name === "AbortError")) {
      console.warn(`[whispers-ai] Gemini timed out after ${LIMITS.GEMINI_TIMEOUT_MS}ms.`);
      return { kind: "timeout" };
    }
    console.error("[whispers-ai] Gemini request failed:", cause);
    return { kind: "provider_unavailable" };
  } finally {
    clearTimeout(timer);
  }
}
