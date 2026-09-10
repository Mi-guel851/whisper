import { isAdminEmail } from "@/lib/admin/emails";
import { rawErrorText } from "@/lib/safeErrorMessage";

/**
 * The server-side half of the error gate's admin exception, for API
 * responses: the caller's allowlisted admin gets the real error text in the
 * response body, every other caller gets `safeMessage`.
 *
 * This is the boundary that matters. `user` is the object the route already
 * validated against GoTrue (`auth.getUser(token)`), and the email GoTrue
 * returns for that validated token is what the SERVER allowlist is checked
 * against — per request, in this function. Nothing a browser sends can
 * influence it, and no non-admin caller ever receives anything but
 * `safeMessage`, whatever the error is.
 *
 * A null user (unauthenticated route) always gets the safe message.
 */
export function errorTextFor(
  user: { email?: string | null } | null | undefined,
  rawError: unknown,
  safeMessage: string
): string {
  if (user && isAdminEmail(user.email, "server")) {
    const raw = rawErrorText(rawError);
    if (raw) return raw;
  }
  return safeMessage;
}
