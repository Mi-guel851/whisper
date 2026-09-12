/**
 * Turning an error into a sentence a person can act on.
 *
 * Ported from the web app's `lib/safeErrorMessage.ts`. The rule there is the
 * rule here: a raw PostgREST message ("duplicate key value violates unique
 * constraint ...") tells the user nothing, and a blanket "Something went wrong"
 * tells them nothing either. Each branch below is a failure somebody actually
 * hit, mapped to what they should do about it.
 */

type AnyError = { message?: string; error_description?: string; code?: string; status?: number } | null | undefined;

export function safeErrorMessage(
  error: unknown,
  fallback = "Something went wrong. Please try again."
): string {
  if (!error) return fallback;

  /* Callers hand this a caught value, which TypeScript types as `unknown` and
     which may be anything at runtime — a PostgREST error object, a `fetch`
     failure, or a thrown string. Everything below is read defensively because
     this function's whole job is to run when something else has already gone
     wrong. */
  if (typeof error === "string") return error.trim() || fallback;

  const candidate = error as AnyError;
  const raw = (candidate?.message || candidate?.error_description || "").trim();
  const message = raw.toLowerCase();
  const code = candidate?.code ?? "";

  if (!message) return fallback;

  /* --- Auth ------------------------------------------------------------- */

  if (message.includes("invalid login credentials") || message.includes("invalid_credentials")) {
    return "That email or password isn't right.";
  }
  if (message.includes("email not confirmed")) {
    return "Check your inbox and confirm your email first.";
  }
  if (message.includes("user already registered") || code === "23505" && message.includes("email")) {
    return "An account with that email already exists. Try logging in instead.";
  }
  if (message.includes("password should be at least")) {
    return "Passwords need to be at least 6 characters.";
  }
  if (message.includes("unable to validate email") || message.includes("invalid email")) {
    return "That doesn't look like a valid email address.";
  }
  if (message.includes("rate limit") || code === "over_email_send_rate_limit") {
    return "Too many attempts. Wait a moment and try again.";
  }
  if (message.includes("email not authorized") || message.includes("signups not allowed")) {
    return "New signups are closed right now.";
  }

  /* --- Network ---------------------------------------------------------- */

  if (
    message.includes("network request failed") ||
    message.includes("failed to fetch") ||
    message.includes("timeout") ||
    message.includes("timed out")
  ) {
    return "Can't reach Whisper. Check your connection and try again.";
  }

  /* --- RLS / permission -------------------------------------------------- */

  if (code === "42501" || message.includes("row-level security") || message.includes("permission denied")) {
    return "You don't have permission to do that.";
  }

  /* --- Storage ----------------------------------------------------------- */

  if (message.includes("payload too large") || message.includes("exceeded the maximum allowed size")) {
    return "That file is too large to upload.";
  }
  if (message.includes("mime type") && message.includes("not supported")) {
    return "That file type isn't supported.";
  }

  /* --- Coins ------------------------------------------------------------- */

  if (message.includes("insufficient") || message.includes("not enough coins")) {
    return "You don't have enough Whisper Coins for that. Top up in the Coin Store.";
  }

  /* --- Schema drift ------------------------------------------------------ */

  if (
    code === "42883" ||
    code === "PGRST202" ||
    /could not find the function|does not exist/i.test(message)
  ) {
    return "That isn't available on this server yet. Please update the app.";
  }

  /* A message that is already a sentence (our own RPCs raise readable
     exceptions) is passed through rather than replaced. Everything else falls
     back, so a stack-shaped string never reaches the user. */
  const looksReadable = raw.length > 0 && raw.length < 180 && /[a-z]/.test(raw) && !raw.includes(" at ");
  return looksReadable ? raw : fallback;
}

/**
 * Whether an error means "this column/function isn't in the schema yet" as
 * opposed to "the request failed". The distinction is what decides whether to
 * permanently downgrade a query path instead of retrying it on every render.
 */
export function isMissingSchema(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  if (error.code === "42883" || error.code === "42703" || error.code === "PGRST202" || error.code === "PGRST204") {
    return true;
  }
  return /does not exist|could not find the function|could not find the .* column|schema cache/i.test(
    error.message ?? ""
  );
}
