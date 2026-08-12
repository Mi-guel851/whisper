/**
 * Whispers AI — every tunable number in one place.
 *
 * The Hugging Face account backing this has a limited inference allowance, so
 * these are cost controls first and UX limits second. Raise them deliberately:
 * `MAX_HISTORY_MESSAGES` and `MAX_RESPONSE_TOKENS` are the two that multiply
 * spend fastest, because history is re-sent on every turn.
 *
 * Anything the browser also needs to know (input maxlength, the trim depth of
 * the history it sends) is mirrored in lib/ai/whispersAiLimits.ts. The server
 * re-checks all of it regardless — the client copy is there so the UI can stop
 * a doomed request before it costs a round trip, not to be trusted.
 */

export const LIMITS = {
  /** Longest single question accepted. Rejected before any Hugging Face call. */
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

  /** Upper bound on the model's reply. ~320 tokens is a long, useful answer. */
  MAX_RESPONSE_TOKENS: 320,

  /** Hard cap on what we hand back, in case the model ignores the token limit. */
  MAX_REPLY_CHARS: 2000,

  /* --- Per-user rate limiting ------------------------------------------- */

  /** Requests allowed inside the rolling window below. */
  REQUESTS_PER_WINDOW: 12,
  WINDOW_SECONDS: 300,

  /** Daily ceiling, so a slow drip can't exhaust the allowance either. */
  REQUESTS_PER_DAY: 80,

  /* --- Upstream ---------------------------------------------------------- */

  /** Abort the Hugging Face call after this. Keeps a hung upstream from
   *  holding an invocation (and the user's spinner) open indefinitely. */
  HF_TIMEOUT_MS: 25_000,

  /** Low, deliberately: this is a support assistant, not a creative writer.
   *  Higher values are where invented features come from. */
  TEMPERATURE: 0.3,
  TOP_P: 0.9,
} as const;

export const HF_CHAT_COMPLETIONS_URL = "https://router.huggingface.co/v1/chat/completions";

/**
 * User-facing error copy. Deliberately vague about causes — a support
 * assistant saying "upstream 503 from router.huggingface.co" is both useless
 * to the user and a small information leak. Real detail goes to the server log.
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
  TIMEOUT: "That took too long. Please try again in a moment.",
} as const;
