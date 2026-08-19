/**
 * Request parsing and validation for Whispers AI.
 *
 * Everything the browser sends is treated as hostile input: the question, the
 * conversation history it claims happened, and the page label. In particular the
 * client is never trusted for the user id — that comes from the verified JWT in
 * the route handler and nothing else. If a `userId` field ever shows up in a
 * request body, it is ignored here rather than read.
 */

import { LIMITS } from "./config";

export type ChatTurn = { role: "user" | "assistant"; content: string };

export type ParsedRequest = {
  question: string;
  history: ChatTurn[];
  context: { page?: string; section?: string };
};

export type ValidationError = { code: "bad_request" | "empty" | "too_long" };

/** Page/section are labels, not data — a strict, tiny alphabet is enough. */
const LABEL_PATTERN = /^[a-z0-9][a-z0-9_-]{0,38}$/;

const TAB = 9;
const NEWLINE = 10;
const SPACE = 32;
const DELETE = 127;

/**
 * Drops control characters while keeping tab and newline, which are legitimate
 * inside a typed question.
 *
 * Written as a code-point walk rather than a regex character class on purpose:
 * a class covering C0 has to contain literal control bytes or escapes that are
 * easy to mangle when the file is edited, and a stray NUL in a source file is a
 * genuinely annoying bug to find.
 */
function stripControl(value: string): string {
  let out = "";
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (code === TAB || code === NEWLINE) {
      out += char;
      continue;
    }
    if (code < SPACE || code === DELETE) continue;
    out += char;
  }
  return out;
}

function safeLabel(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const cleaned = value.trim().toLowerCase();
  return LABEL_PATTERN.test(cleaned) ? cleaned : undefined;
}

/**
 * Collapses the whitespace runs a paste can carry, so a "500 character" limit
 * means 500 characters of question rather than 480 blank lines.
 */
function normalizeText(value: string): string {
  return stripControl(value.replace(/\r\n?/g, "\n"))
    .replace(/[ \t]{3,}/g, "  ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function parseHistory(value: unknown): ChatTurn[] {
  if (!Array.isArray(value)) return [];

  const turns: ChatTurn[] = [];

  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;

    const role = record.role;
    if (role !== "user" && role !== "assistant") continue;

    const content = typeof record.content === "string" ? normalizeText(record.content) : "";
    if (!content) continue;

    turns.push({ role, content: content.slice(0, LIMITS.MAX_HISTORY_CHARS) });
  }

  /* Keep the most recent turns, and make sure the window starts on a user turn
     so the model never sees an assistant reply with no question in front of it.
     Gemini rejects a `contents` array that opens on a model turn. */
  const tail = turns.slice(-LIMITS.MAX_HISTORY_MESSAGES);
  while (tail.length > 0 && tail[0].role === "assistant") tail.shift();

  return tail;
}

export function parseRequest(body: unknown): ParsedRequest | ValidationError {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { code: "bad_request" };
  }

  const record = body as Record<string, unknown>;

  /* `message` is the documented field; `question` is accepted as an alias so a
     future caller getting it slightly wrong isn't a mystery 400. */
  const raw = record.message ?? record.question;
  if (typeof raw !== "string") return { code: "bad_request" };

  const question = normalizeText(raw);
  if (!question) return { code: "empty" };
  if (question.length > LIMITS.MAX_QUESTION_CHARS) return { code: "too_long" };

  const contextInput =
    record.context && typeof record.context === "object" && !Array.isArray(record.context)
      ? (record.context as Record<string, unknown>)
      : {};

  const page = safeLabel(contextInput.page);
  const section = safeLabel(contextInput.section);

  return {
    question,
    history: parseHistory(record.history),
    context: {
      ...(page ? { page } : {}),
      ...(section ? { section } : {}),
    },
  };
}
