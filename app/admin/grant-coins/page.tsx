import { redirect } from "next/navigation";

/**
 * The Grant Coins screen moved into the admin panel at /admin/coins.
 *
 * This route is kept as a redirect rather than deleted: it was the URL the panel
 * was reached at, it may be bookmarked, and a stale deployed client could still
 * link to it. The functionality is unchanged — same endpoint, same PIN
 * verification on every request, same `admin_grant_coins` RPC — it is now one
 * section of a shell that also shows the balance before granting and the ledger
 * after.
 *
 * A SERVER redirect rather than a `router.replace` in a client component, and
 * the distinction matters. This page sits under app/admin/layout.tsx, so a
 * client-side redirect would first mount AdminShell and run its gate — the
 * visitor would see the branded loader, possibly the PIN screen, and only then
 * be moved on. Throwing `redirect()` here answers with a 307 before any of that
 * renders, so opening the old URL goes straight to the Coins section.
 *
 * `redirect` also replaces the history entry, so the back button does not land
 * here and bounce forward again.
 */
export default function GrantCoinsRedirect() {
  redirect("/admin/coins");
}
