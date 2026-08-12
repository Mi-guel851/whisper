/**
 * The Hugging Face call — the only place in this repository that touches the
 * inference token.
 *
 * `HF_API_TOKEN` and `HF_CHAT_MODEL` are read from the Edge Function's
 * environment (Supabase secrets) at request time. Neither value is ever placed
 * in a response body, a thrown error, or a log line: the failure taxonomy below
 * deliberately maps upstream status codes onto opaque outcome names, so the
 * worst a caller can learn is "unavailable".
 */

import { HF_CHAT_COMPLETIONS_URL, LIMITS } from "./config.ts";
import type { ChatTurn } from "./validate.ts";

export type HfOutcome =
  | { kind: "ok"; reply: string }
  | { kind: "rate_limited"; retryAfterSeconds: number }
  | { kind: "timeout" }
  | { kind: "unavailable" };

type HfChoice = {
  message?: { content?: unknown; role?: string };
  finish_reason?: string;
};

type HfResponse = {
  choices?: HfChoice[];
  error?: unknown;
};

/**
 * Some models routed through Hugging Face emit a visible reasoning preamble
 * (`<think>…</think>`) ahead of the answer. Left in, it reads as the assistant
 * talking to itself. Stripped here rather than in the UI so every consumer of
 * this function gets the clean text.
 */
function stripReasoning(text: string): string {
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

function retryAfterFrom(response: Response): number {
  const header = response.headers.get("retry-after");
  const parsed = header ? Number.parseInt(header, 10) : Number.NaN;
  if (Number.isFinite(parsed) && parsed > 0) return Math.min(parsed, 600);
  return 60;
}

export type HfConfig = { token: string; model: string };

/** Reads the two secrets. Returns null (and logs a name, never a value) when
 *  either is missing, so the caller can answer "temporarily unavailable"
 *  instead of calling Hugging Face without credentials. */
export function readHfConfig(): HfConfig | null {
  const token = Deno.env.get("HF_API_TOKEN");
  const model = Deno.env.get("HF_CHAT_MODEL");

  if (!token || !model) {
    const missing = [!token && "HF_API_TOKEN", !model && "HF_CHAT_MODEL"].filter(Boolean);
    console.error(
      `[whispers-ai] missing Supabase secret(s): ${missing.join(", ")}. Set them with \`supabase secrets set\`.`
    );
    return null;
  }

  return { token, model };
}

export async function askHuggingFace(
  config: HfConfig,
  systemPrompt: string,
  history: ChatTurn[],
  question: string
): Promise<HfOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LIMITS.HF_TIMEOUT_MS);

  try {
    const response = await fetch(HF_CHAT_COMPLETIONS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.token}`,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: "system", content: systemPrompt },
          ...history,
          { role: "user", content: question },
        ],
        max_tokens: LIMITS.MAX_RESPONSE_TOKENS,
        temperature: LIMITS.TEMPERATURE,
        top_p: LIMITS.TOP_P,
        stream: false,
      }),
    });

    if (!response.ok) {
      /* Read at most a little of the body for the server log. It can contain
         the provider's own message but never our token — and it never leaves
         this process. */
      const detail = (await response.text().catch(() => "")).slice(0, 400);

      if (response.status === 429) {
        console.warn("[whispers-ai] Hugging Face rate limited the request.");
        return { kind: "rate_limited", retryAfterSeconds: retryAfterFrom(response) };
      }

      if (response.status === 401 || response.status === 403) {
        console.error(
          "[whispers-ai] Hugging Face rejected the credentials (check the HF_API_TOKEN secret and its permissions)."
        );
        return { kind: "unavailable" };
      }

      if (response.status === 402) {
        console.error("[whispers-ai] Hugging Face inference credits appear to be exhausted.");
        return { kind: "unavailable" };
      }

      if (response.status === 404) {
        console.error(
          "[whispers-ai] Hugging Face has no such routed model — check the HF_CHAT_MODEL secret."
        );
        return { kind: "unavailable" };
      }

      console.error(`[whispers-ai] Hugging Face returned ${response.status}: ${detail}`);
      return { kind: "unavailable" };
    }

    const payload = (await response.json().catch(() => null)) as HfResponse | null;
    const choice = payload?.choices?.[0];
    const rawContent = choice?.message?.content;

    if (typeof rawContent !== "string") {
      console.error("[whispers-ai] unexpected Hugging Face response shape.");
      return { kind: "unavailable" };
    }

    const cleaned = tidyTail(
      stripReasoning(rawContent),
      choice?.finish_reason === "length"
    ).slice(0, LIMITS.MAX_REPLY_CHARS);

    if (!cleaned) {
      console.error("[whispers-ai] Hugging Face returned an empty completion.");
      return { kind: "unavailable" };
    }

    return { kind: "ok", reply: cleaned };
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === "AbortError") {
      console.warn(`[whispers-ai] Hugging Face timed out after ${LIMITS.HF_TIMEOUT_MS}ms.`);
      return { kind: "timeout" };
    }
    console.error("[whispers-ai] Hugging Face request failed:", cause);
    return { kind: "unavailable" };
  } finally {
    clearTimeout(timer);
  }
}
