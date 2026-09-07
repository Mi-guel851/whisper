/**
 * Who may open the admin panel.
 *
 * ONE LIST, TWO READERS. app/premium/page.tsx has carried this pair since the
 * Grant Coins shortcut was added, and lib/admin/auth.ts now enforces the same
 * pair on every admin request. They used to be two copies of the same two
 * strings; this module is why they are no longer. A third account added to one
 * and not the other would produce the worst possible failure mode — a button
 * that leads to a 403 — so both sides import it.
 *
 * WHY THE SERVER COPY MATTERS MORE THAN THE CLIENT ONE
 *
 * The client copy decides what is *shown*: whether the Grant Coins shortcut
 * appears on the wallet page, whether /admin renders its panel or its "not
 * authorized" screen. That is convenience, and the comment in
 * app/premium/page.tsx has always been honest that it is not a boundary — both
 * addresses ship in the public bundle, so anyone can read them.
 *
 * The server copy in lib/admin/auth.ts decides what is *allowed*. It is checked
 * per request, against the email GoTrue returns for a validated access token,
 * before the PIN is even compared. Nothing the browser does can change it.
 *
 * WHY AN EMAIL LIST AND NOT `profiles.is_admin`
 *
 * That column exists and is the more natural answer, but it has to be set by
 * hand in the SQL editor, `guard_profile_is_admin` coerces it back to false on
 * insert, and an account missing it is indistinguishable from a database that
 * never had the column. app/api/admin/verify-pin/route.ts documents the same
 * reasoning for the original Grant Coins screen. An allowlist of two addresses
 * is auditable in one place and cannot be silently empty.
 *
 * OVERRIDING WITHOUT A REDEPLOY: set `ADMIN_EMAILS` to a comma-separated list
 * (NEXT_PUBLIC_ADMIN_EMAILS for the client copy, ADMIN_EMAILS for the server
 * one). Both fall back to the two addresses below, so an unset variable is the
 * same as today's behaviour rather than a locked-out panel.
 */

/** The accounts allowed into the admin panel. Lowercased; compared lowercased. */
export const DEFAULT_ADMIN_EMAILS = [
  "mfonisobassey851@gmail.com",
  "basseyaniekeme43@gmail.com",
] as const;

/**
 * The effective allowlist, for whichever side is reading it.
 *
 * Server: `process.env.ADMIN_EMAILS`. Client: `NEXT_PUBLIC_ADMIN_EMAILS`. A
 * server-only name is not inlined into the browser bundle, so passing the wrong
 * one silently yields the defaults — which is the safe direction.
 */
export function adminEmails(side: "server" | "client"): Set<string> {
  const raw =
    side === "server" ? process.env.ADMIN_EMAILS : process.env.NEXT_PUBLIC_ADMIN_EMAILS;

  const parsed = (raw ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);

  return new Set(parsed.length > 0 ? parsed : DEFAULT_ADMIN_EMAILS);
}

/** True when this email may open the panel. Normalises case and surrounding space. */
export function isAdminEmail(
  email: string | null | undefined,
  side: "server" | "client" = "client"
): boolean {
  if (!email) return false;
  return adminEmails(side).has(email.trim().toLowerCase());
}
