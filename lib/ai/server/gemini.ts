/**
 * The Gemini call — the only place in this repository that touches the API key.
 *
 * `GEMINI_API_KEY` is read from the server environment (Vercel project
 * environment variables in production, `.env` / `.env.local` in development) at
 * request time. It is never placed in a response body, a thrown error, or a log
 * line: the failure taxonomy below deliberately maps upstream status codes onto
 * opaque outcome names, so the worst a caller can learn is "unavailable".
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
 * Deliberately not a whitelist of model names: Google ships new ids continuously
 * and retires old ones, and a whitelist would turn "use the current model" into a
 * code change. This only rejects values that couldn't be a model id at all — a
 * full URL, a shell fragment, a path.
 */
function sanitizeModel(value: string | undefined): string | null {
  let model = value?.trim();
  if (!model) return null;

  // `models/gemini-flash-latest` is how the API names them in responses; accept
  // it and normalise, because it is an easy thing to paste in.
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
      "[whispers-ai] missing environment variable: GEMINI_API_KEY. Add it in Vercel (Project → Settings → Environment Variables) and redeploy, or to .env for local development."
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
 * Models to fall back through when the configured one is rejected.
 *
 * This exists because of a real outage. The default used to be the pinned id
 * `gemini-2.5-flash`; Google retired it, every request came back 404, and the app
 * showed "Whispers AI is being updated" indefinitely — a message that is
 * indistinguishable from a transient blip, so nothing pointed at the real cause.
 *
 * The ladder runs newest-alias first, then specific families, so a key with
 * access to any current Flash model works without configuration. Aliases lead
 * because they cannot go stale; the pinned ids behind them are there for a key
 * whose project only has an older family enabled.
 */
const MODEL_LADDER = [
  "gemini-flash-latest",
  "gemini-3.5-flash",
  "gemini-3-flash",
  "gemini-2.5-flash",
  "gemini-flash-lite-latest",
] as const;

/**
 * Hard ceiling on upstream HTTP calls for one question.
 *
 * The ladder is longer than this on purpose — it is a list of candidates, not a
 * plan to try all of them. Four attempts is enough to get past a retired model id
 * plus one body-compatibility retry, and few enough that a systematically broken
 * request can't multiply one user's question into a dozen billed calls.
 */
const MAX_ATTEMPTS = 4;

function modelLadder(configured: string): string[] {
  // The configured model is always tried first, even if it is also in the ladder.
  return [configured, ...MODEL_LADDER.filter((model) => model !== configured)];
}

/**
 * Whether to ask this model to stop thinking.
 *
 * This matters more than it looks. On the 2.5 family, thinking tokens are billed
 * against `maxOutputTokens` — so a model left to think freely can spend the
 * entire budget reasoning and return `finishReason: MAX_TOKENS` with **no text
 * parts at all**. For a support assistant answering "how do I transfer coins?"
 * that is pure cost and pure latency for no answer.
 *
 * `thinkingBudget: 0` turns it off, but not every model accepts 0 — Pro's minimum
 * is 128 and it 400s on zero. So the field goes only to Flash ids, and if a
 * future Flash model rejects it too, the `retry_simpler_body` path below drops it
 * and tries again rather than failing the question.
 */
function canDisableThinking(model: string): boolean {
  const id = model.toLowerCase();
  if (id.includes("pro")) return false;
  return id.includes("flash");
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

type GeminiContent = { role: string; parts: { text: string }[] };

/**
 * Builds the request body.
 *
 * `simple` drops the two optional refinements — the thinking budget and the
 * safety thresholds. Both are the kind of field a new model family can rename or
 * stop accepting, and either would 400 the whole request. Retrying without them
 * costs one extra call and keeps the assistant answering on a model whose exact
 * feature set we don't know yet.
 */
function buildBody(
  model: string,
  systemPrompt: string,
  contents: GeminiContent[],
  simple: boolean
) {
  return {
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents,
    generationConfig: {
      temperature: LIMITS.TEMPERATURE,
      topP: LIMITS.TOP_P,
      maxOutputTokens: LIMITS.MAX_RESPONSE_TOKENS,
      candidateCount: 1,
      ...(!simple && canDisableThinking(model)
        ? { thinkingConfig: { thinkingBudget: 0 } }
        : {}),
    },
    ...(simple ? {} : { safetySettings: SAFETY_SETTINGS }),
  };
}

/** Terminal outcomes, plus the two signals that ask `askGemini` to try again. */
type AttemptResult =
  | GeminiOutcome
  | { kind: "retry_other_model" }
  | { kind: "retry_simpler_body" };

/**
 * A 400 that is about the *shape* of the request rather than its content.
 *
 * Google's wording for these is stable enough to match on, and getting it wrong
 * is cheap in both directions: a false positive costs one retry with a smaller
 * body, a false negative costs nothing beyond the outcome we'd have returned.
 */
function looksLikeUnsupportedField(detail: string): boolean {
  return /unknown name|invalid json payload|cannot find field|not supported|invalid value at|unsupported/i.test(
    detail
  );
}

async function generateOnce(
  apiKey: string,
  model: string,
  systemPrompt: string,
  contents: GeminiContent[],
  simple: boolean,
  signal: AbortSignal
): Promise<AttemptResult> {
  const response = await fetch(geminiEndpoint(model), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    signal,
    body: JSON.stringify(buildBody(model, systemPrompt, contents, simple)),
  });

  if (!response.ok) {
    /* Read a little of the body for the server log. It can contain Google's own
       message but never our key — and it never leaves this process. */
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

    if (response.status === 404) {
      /* The model id doesn't exist for this key — almost always a retirement.
         Worth a warning rather than an error, because the ladder is about to
         recover from it. */
      console.warn(
        `[whispers-ai] Gemini has no model named ${model} on v1beta (retired, or not enabled for this key). Trying the next candidate.`
      );
      return { kind: "retry_other_model" };
    }

    if (response.status === 400) {
      /* 400 covers three very different faults: an unusable key, a field this
         model doesn't accept, and a genuinely malformed request. They need
         different fixes, so they get different log lines and different paths. */
      if (/api[_ ]?key/i.test(detail)) {
        console.error(
          "[whispers-ai] Gemini says the API key is not valid. Re-copy it from Google AI Studio and update GEMINI_API_KEY."
        );
        return { kind: "authentication_error" };
      }

      if (!simple) {
        console.warn(
          `[whispers-ai] Gemini rejected the request for ${model}${
            looksLikeUnsupportedField(detail) ? " (unsupported field)" : ""
          }. Retrying without the optional generation fields: ${detail}`
        );
        return { kind: "retry_simpler_body" };
      }

      console.error(
        `[whispers-ai] Gemini rejected even the minimal request body for ${model}: ${detail}`
      );
      return { kind: "retry_other_model" };
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
      /* Only reachable on a model where thinking couldn't be switched off — the
         budget went entirely on reasoning. Raising MAX_RESPONSE_TOKENS or pinning
         GEMINI_CHAT_MODEL to a model that accepts thinkingBudget: 0 fixes it. */
      console.error(
        `[whispers-ai] Gemini hit MAX_TOKENS before emitting any text on ${model}. Thinking consumed the whole output budget.`
      );
      return { kind: "empty_response" };
    }
    console.error(
      `[whispers-ai] Gemini returned no text on ${model} (finishReason: ${finishReason || "none"}).`
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

  return { kind: "ok", reply: cleaned, model };
}

export async function askGemini(
  config: GeminiConfig,
  systemPrompt: string,
  history: ChatTurn[],
  question: string
): Promise<GeminiOutcome> {
  /* One controller for the whole ladder, not one per attempt. Retries have to
     share a single deadline — three attempts with their own 20s budget would add
     up to 60s and let Vercel kill the invocation, which replaces our JSON with an
     opaque gateway page. */
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LIMITS.GEMINI_TIMEOUT_MS);

  /* Gemini's roles are `user` and `model` — it has no `assistant`, and no
     `system` role either: the system prompt is its own top-level field. */
  const contents: GeminiContent[] = [
    ...history.map((turn) => ({
      role: turn.role === "assistant" ? "model" : "user",
      parts: [{ text: turn.content }],
    })),
    { role: "user", parts: [{ text: question }] },
  ];

  const ladder = modelLadder(config.model);

  try {
    let modelIndex = 0;
    let simple = false;
    let attempts = 0;

    while (modelIndex < ladder.length && attempts < MAX_ATTEMPTS) {
      if (controller.signal.aborted) break;

      const model = ladder[modelIndex];
      attempts += 1;

      const result = await generateOnce(
        config.apiKey,
        model,
        systemPrompt,
        contents,
        simple,
        controller.signal
      );

      if (result.kind === "retry_simpler_body") {
        simple = true;
        continue;
      }

      if (result.kind === "retry_other_model") {
        modelIndex += 1;
        simple = false;
        continue;
      }

      if (result.kind === "ok" && model !== config.model) {
        /* Worth a log line: the configured model isn't working, and pinning
           GEMINI_CHAT_MODEL to the one that did saves the failed calls on every
           later request. */
        console.warn(
          `[whispers-ai] answered with fallback model ${model} because ${config.model} was rejected. Set GEMINI_CHAT_MODEL=${model} to skip the failed attempts.`
        );
      }

      return result;
    }

    if (controller.signal.aborted) {
      console.warn(`[whispers-ai] Gemini timed out after ${LIMITS.GEMINI_TIMEOUT_MS}ms.`);
      return { kind: "timeout" };
    }

    console.error(
      `[whispers-ai] no Gemini model accepted the request after ${attempts} attempt(s). Tried: ${ladder
        .slice(0, modelIndex + 1)
        .join(", ")}. Check which models the key can use: GET https://generativelanguage.googleapis.com/v1beta/models`
    );
    return { kind: "model_unavailable" };
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
