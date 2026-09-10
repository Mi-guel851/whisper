/**
 * The single gate between internal errors and anything a user can read.
 *
 * Every surface that shows a failure to a person — toasts, page error states,
 * /api responses, the app-level error boundary — funnels through this function
 * instead of handing `error.message` straight to the UI.
 *
 * THE RULE
 *
 * A message may reach the user verbatim only if the app itself (or Supabase
 * Auth, which writes end-user copy) composed it for the user. Everything that
 * carries a SQLSTATE, a PGRST prefix, a table or function name, a constraint
 * name, an env var, or a stack fragment is server detail, and server detail
 * gets one generic sentence. The detail itself is never lost: server routes
 * console.error it to the deployment log before responding, so the operator
 * still has the full text — just not in the browser.
 *
 * This module is imported by both the browser and the Node runtime, so it stays
 * small and dependency-free — with one deliberate state: the debug flag above,
 * which components/AdminDebugGate.tsx sets from the session.
 *
 * The allowlist-aware server half lives in lib/errorTextFor.ts on purpose:
 * this file stays dependency-free (the browser and the test harness both load
 * it without alias resolution), and the browser never needs to know who an
 * admin is.
 */

export const SAFE_GENERIC = "Something went wrong. Please try again.";
export const SAFE_OFFLINE =
  "You look offline. Check your connection and try again.";
export const SAFE_FEATURE_MISSING =
  "This isn't available on this server yet. Please try again in a bit.";
export const SAFE_RATE_LIMITED =
  "You're moving a little fast — give it a second and try again.";

/* -------------------------------------------------------------------------- *
 *  Admin debug mode
 * -------------------------------------------------------------------------- */

let debugErrors = false;

/**
 * The two accounts on the admin allowlist are the people who have to READ the
 * real errors while debugging; everyone else gets the gated sentence.
 *
 * Client side: components/AdminDebugGate.tsx flips this from the session the
 * browser already holds, against the CLIENT copy of the allowlist. That is a
 * display decision, not a boundary — a visitor could set it in devtools and
 * only ever see errors their own browser already received.
 *
 * Server side: the boundary that actually matters is errorTextFor in
 * lib/errorTextFor.ts, which checks the email GoTrue returns for the validated
 * access token against the SERVER allowlist, per request. Nothing a browser
 * sends can influence it.
 */
export function setDebugErrors(enabled: boolean): void {
  debugErrors = enabled;
}

export function debugErrorsEnabled(): boolean {
  return debugErrors;
}

/* -------------------------------------------------------------------------- *
 *  What may pass through verbatim
 * -------------------------------------------------------------------------- */

/**
 * Copy that is written FOR the user, verified case-insensitively. These are
 * the Supabase Auth strings (GoTrue writes them for end users) plus the app's
 * own curated failures. Deliberately an allowlist: the day a new GoTrue error
 * string ships, it lands here as a generic sentence, never as a surprise.
 */
const USER_SAFE_PATTERNS: RegExp[] = [
  /^invalid login credentials$/i,
  /^email not confirmed$/i,
  /^email already registered$/i,
  /^user already registered$/i,
  /^password should be at least \d+ characters$/i,
  /^password .* does not meet/i,
  /^signup is disabled$/i,
  /^otp is invalid/i,
  /^email link expired$/i,
  /^session expired/i,
  /^token expired/i,
  /^the user denied the request/i,
  /* The ban triggers raise this exact sentence (202609080001 §B2) — a banned
     user must be told, in words they can act on, rather than a generic
     "something went wrong". */
  /^your account has been restricted/i,
  /* App-composed failures the API routes already returned to the client. */
  /^insufficient coins/i,
  /^insufficient balance/i,
  /^server not configured$/i,
  /^invalid session$/i,
  /^not authenticated$/i,
];

/* -------------------------------------------------------------------------- *
 *  What never passes through
 * -------------------------------------------------------------------------- */

/** Browser/WebView-level fetch failures — network reality, not app fault. */
const NETWORK_PATTERN =
  /failed to fetch|network request failed|load failed|networkerror|the internet connection appears to be offline|err_(internet_disconnected|network)/i;

/**
 * "The feature isn't deployed" signatures. These used to surface as
 * `PGRST202: could not find the function...` toasts — schema detail about our
 * deployment state. Now one sentence, same meaning.
 */
const FEATURE_MISSING_PATTERN =
  /^pgrst\d+:|^42883\b|^42p01\b|could not find the (function|relation)|relation "public\.|does not exist/i;

/**
 * Authorization internals — RLS policy names, permission denials, constraint
 * violations. The user can do nothing with these strings, and reading them is
 * how an attacker maps the schema. Generic, always.
 */
const INTERNAL_PATTERN =
  /^pgrst\d+:|^23\d{3}\b|^42501\b|^22p02\b|row-level security policy|permission denied|new row violates|violates (unique|check|foreign) constraint|duplicate key|syntax error at or near/i;

function toParts(error: unknown): { message: string; code: string | undefined } {
  if (error == null) return { message: "", code: undefined };

  if (error instanceof Error) {
    const code = (error as { code?: unknown }).code;
    return { message: error.message, code: typeof code === "string" ? code : undefined };
  }

  if (typeof error === "string") return { message: error, code: undefined };

  if (typeof error === "object") {
    const e = error as {
      message?: unknown;
      code?: unknown;
      error_description?: unknown;
      error?: unknown;
    };
    /* OAuth-style payloads ({ error, error_description }) don't extend Error,
       so the description is what a user would otherwise get toasted verbatim. */
    const message =
      typeof e.message === "string" && e.message.length > 0
        ? e.message
        : typeof e.error_description === "string"
          ? e.error_description
          : "";
    const code = typeof e.code === "string" ? e.code : undefined;
    return { message, code };
  }

  return { message: String(error), code: undefined };
}

/** The raw text a developer would want: the message, or the code, or nothing. */
export function rawErrorText(error: unknown): string {
  const { message, code } = toParts(error);
  return message || code || "";
}

/**
 * Turn any thrown/returned value into a sentence a user is meant to read.
 *
 * `fallback` overrides the generic "something went wrong" for call sites that
 * already know the *kind* of failure in plain words (e.g. "Couldn't send that
 * message.") — the detail never leaks either way.
 */
export function safeErrorMessage(
  error: unknown,
  fallback: string = SAFE_GENERIC
): string {
  const { message, code } = toParts(error);

  if (!message && !code) return fallback;

  /* The allowlisted admins read the real text — that is how a missing column
     or a failed trigger gets found. Everyone else falls through to the gate. */
  if (debugErrors) return message || code || fallback;

  for (const safe of USER_SAFE_PATTERNS) {
    if (safe.test(message)) return message;
  }

  if (code === "429" || /too many requests/i.test(message)) return SAFE_RATE_LIMITED;
  if (NETWORK_PATTERN.test(message)) return SAFE_OFFLINE;
  if (FEATURE_MISSING_PATTERN.test(message) || (code && FEATURE_MISSING_PATTERN.test(code))) {
    return SAFE_FEATURE_MISSING;
  }
  if (INTERNAL_PATTERN.test(message) || (code && INTERNAL_PATTERN.test(code))) {
    return fallback;
  }

  return fallback;
}
