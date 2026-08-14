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
  | { kind: "ok"; reply: string; model: string }
  | { kind: "rate_limited"; retryAfterSeconds: number }
  | { kind: "timeout" }
  | { kind: "configuration_error" }
  | { kind: "authentication_error" }
  | { kind: "model_unavailable" }
  | { kind: "provider_unavailable" };

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

const DEFAULT_CHAT_MODEL = "openai/gpt-oss-20b:fastest";

function sanitizeModel(value: string | undefined): string | null {
  const model = value?.trim();
  if (!model) return null;

  /* Accept only the model identifier expected by Hugging Face's OpenAI-compatible
     router. This blocks accidental full URLs or shell fragments from a bad secret
     while preserving provider suffixes such as `:fastest`. */
  if (!/^[A-Za-z0-9._\/-]+(?::[A-Za-z0-9._-]+)?$/.test(model)) return null;
  if (model.startsWith("http://") || model.startsWith("https://")) return null;
  return model;
}

/** Reads the two secrets. Returns null (and logs a name, never a value) when
 *  either is missing, so the caller can answer "temporarily unavailable"
 *  instead of calling Hugging Face without credentials. */
export function readHfConfig(): HfConfig | null {
  const token = Deno.env.get("HF_API_TOKEN")?.trim();
  const configuredModel = Deno.env.get("HF_CHAT_MODEL");
  const model = sanitizeModel(configuredModel) ?? DEFAULT_CHAT_MODEL;

  if (!token) {
    console.error("[whispers-ai] missing Supabase secret: HF_API_TOKEN. Set it with `supabase secrets set`.");
    return null;
  }

  if (configuredModel && !sanitizeModel(configuredModel)) {
    console.error("[whispers-ai] HF_CHAT_MODEL is not a valid Hugging Face router model id. Falling back to the default chat model.");
  } else if (!configuredModel?.trim()) {
    console.warn("[whispers-ai] HF_CHAT_MODEL is missing. Falling back to the default chat model; set the secret to pin production to a specific model.");
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
        return { kind: "authentication_error" };
      }

      if (response.status === 400 || response.status === 422) {
        console.error(`[whispers-ai] Hugging Face rejected the chat-completions request for model ${config.model}: ${detail}`);
        return { kind: "model_unavailable" };
      }

      if (response.status === 402) {
        console.error("[whispers-ai] Hugging Face inference credits appear to be exhausted.");
        return { kind: "provider_unavailable" };
      }

      if (response.status === 404) {
        console.error(
          `[whispers-ai] Hugging Face has no routed chat-completions model named ${config.model} — check HF_CHAT_MODEL.`
        );
        return { kind: "model_unavailable" };
      }

      if (response.status >= 500) {
        console.error(`[whispers-ai] Hugging Face provider/server failure ${response.status}: ${detail}`);
        return { kind: "provider_unavailable" };
      }

      console.error(`[whispers-ai] Hugging Face returned ${response.status}: ${detail}`);
      return { kind: "provider_unavailable" };
    }

    const payload = (await response.json().catch(() => null)) as HfResponse | null;
    const choice = payload?.choices?.[0];
    const rawContent = choice?.message?.content;

    if (typeof rawContent !== "string") {
      console.error("[whispers-ai] unexpected Hugging Face response shape.");
      return { kind: "provider_unavailable" };
    }

    const cleaned = tidyTail(
      stripReasoning(rawContent),
      choice?.finish_reason === "length"
    ).slice(0, LIMITS.MAX_REPLY_CHARS);

    if (!cleaned) {
      console.error("[whispers-ai] Hugging Face returned an empty completion.");
      return { kind: "provider_unavailable" };
    }

    return { kind: "ok", reply: cleaned, model: config.model };
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === "AbortError") {
      console.warn(`[whispers-ai] Hugging Face timed out after ${LIMITS.HF_TIMEOUT_MS}ms.`);
      return { kind: "timeout" };
    }
    console.error("[whispers-ai] Hugging Face request failed:", cause);
    return { kind: "provider_unavailable" };
  } finally {
    clearTimeout(timer);
  }
}
