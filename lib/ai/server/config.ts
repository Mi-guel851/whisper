/**
 * Whispers AI — every tunable number in one place.
 *
 * These are cost controls first and UX limits second. Raise them deliberately:
 * `MAX_HISTORY_MESSAGES` and `MAX_RESPONSE_TOKENS` are the two that multiply
 * spend fastest, because the history is re-sent on every turn.
 *
 * Anything the browser also needs to know (input maxlength, the trim depth of
 * the history it sends) is mirrored in lib/ai/whispersAi.ts. The server
 * re-checks all of it regardless — the client copy is there so the UI can stop
 * a doomed request before it costs a round trip, not to be trusted.
 *
 * Nothing in this directory may be imported from a client component. It is
 * reached only by app/api/whispers-ai/route.ts, which runs on the server and is
 * the only place `GEMINI_API_KEY` is read.
 */

export const LIMITS = {
  /** Longest single question accepted. Rejected before any Gemini call. */
  MAX_QUESTION_CHARS: 500,

  /**
   * How many prior turns travel with a question, newest first.
   *
   * 6 is three exchanges — enough for "how do I transfer coins?" → "where's my
   * wallet address?" to resolve, without paying to re-send a whole session.
   */
  MAX_HISTORY_MESSAGES: 6,

  /** Each history entry is clipped to this before being sent. */
  MAX_HISTORY_CHARS: 600,

  /**
   * Upper bound on the model's reply.
   *
   * Higher than the 320 this used to be, because Gemini's free allowance is
   * metered in requests per minute and per day rather than in tokens — so a
   * tight ceiling bought nothing and truncated the numbered-steps answers, which
   * are the ones users most need in full. `tidyTail` still trims a reply that
   * reaches the cap back to its last complete sentence.
   */
  MAX_RESPONSE_TOKENS: 640,

  /** Hard cap on what we hand back, in case the model ignores the token limit. */
  MAX_REPLY_CHARS: 2000,

  /* --- Per-user rate limiting ------------------------------------------- */

  /** Requests allowed inside the rolling window below. */
  REQUESTS_PER_WINDOW: 12,
  WINDOW_SECONDS: 300,

  /** Daily ceiling, so a slow drip can't exhaust the allowance either. */
  REQUESTS_PER_DAY: 80,

  /* --- Upstream ---------------------------------------------------------- */

  /**
   * Abort the Gemini call after this.
   *
   * Deliberately below the route's own `maxDuration`. If the platform kills the
   * invocation first, the client receives Vercel's opaque gateway error instead
   * of our JSON, and every one of the friendly messages below is bypassed — so
   * our timeout has to fire first, with room to spare for the response trip.
   */
  GEMINI_TIMEOUT_MS: 20_000,

  /** Low, deliberately: this is a support assistant, not a creative writer.
   *  Higher values are where invented features come from. */
  TEMPERATURE: 0.3,
  TOP_P: 0.9,
} as const;

/**
 * Default model.
 *
 * Flash rather than Pro: the answers are short, grounded lookups against a
 * system prompt, which is what Flash is good at and what Pro would only make
 * slower and more expensive. Override with the `GEMINI_CHAT_MODEL` environment
 * variable — see `readGeminiConfig`.
 */
export const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";

const GEMINI_API_ROOT = "https://generativelanguage.googleapis.com/v1beta/models";

/** The generateContent endpoint for one model. The key travels in a header, not
 *  here — a key in a query string ends up in access logs and proxy traces. */
export function geminiEndpoint(model: string): string {
  return `${GEMINI_API_ROOT}/${encodeURIComponent(model)}:generateContent`;
}

/**
 * User-facing error copy. Deliberately vague about causes — a support
 * assistant saying "upstream 503 from generativelanguage.googleapis.com" is both
 * useless to the user and a small information leak. Real detail goes to the
 * server log.
 */
export const MESSAGES = {
  UNAUTHENTICATED: "Sign in to Whisper to chat with Whispers AI.",
  BAD_REQUEST: "That didn't come through properly. Try sending your question again.",
  EMPTY: "Type a question and Whispers AI will help.",
  TOO_LONG: `Keep it under ${LIMITS.MAX_QUESTION_CHARS} characters so Whispers AI can answer properly.`,
  RATE_LIMITED: "You've asked a lot in a short time. Give Whispers AI a minute and try again.",
  DAILY_LIMIT: "You've reached today's Whispers AI limit. It resets tomorrow.",
  IN_FLIGHT: "Whispers AI is still working on your last question — one moment.",
  UNAVAILABLE: "Whispers AI is temporarily unavailable. Please try again in a moment.",
  CONFIGURATION: "Whispers AI is not configured correctly yet. Please try again later.",
  PROVIDER_AUTH: "Whispers AI is temporarily unavailable. Please try again in a moment.",
  MODEL_UNAVAILABLE: "Whispers AI is being updated. Please try again in a moment.",
  TIMEOUT: "That took too long. Please try again in a moment.",
  BLOCKED: "I can't help with that one. Ask me about using Whisper and I'll do my best.",
} as const;
