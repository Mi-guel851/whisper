/**
 * Where the user is standing, expressed as something safe to send to a model.
 *
 * The whole contract is two short lowercase labels — `{ page: "coins", section:
 * "transfer" }`. That is deliberately far less than the route itself contains:
 * `/chat/8f1c…` and `/u/someusername` both carry identifiers that say who
 * someone is talking to, and neither has any business reaching an AI provider.
 * So this maps routes onto a fixed vocabulary and drops every dynamic segment
 * on the way through. Nothing derived from user data — no username, no
 * conversation id, no query values beyond a known tab name — is ever included.
 *
 * The Edge Function also treats these as untrusted labels and only uses them to
 * look up a key in its topic map, so an unexpected value degrades to "no page
 * context" rather than becoming part of the prompt.
 */

import type { AiPageContext } from "./whispersAi";

/**
 * Exact-match routes. Keys are pathnames, values are the `page` label.
 *
 * The labels are the ones the function's knowledge base knows about, which is
 * why they don't always match the route: `/premium` is where the Coin Store
 * lives, and "coins" is what a question about it is actually about.
 */
const EXACT: Record<string, string> = {
  "/dashboard": "dashboard",
  "/premium": "coins",
  "/inbox": "chats",
  "/notifications": "whispers",
  "/profile": "profile",
  "/appearance": "appearance",
  "/settings": "settings",
  "/discover": "discover",
  "/friends": "friends",
  "/active": "friends",
  "/public-feed": "feed",
  "/analytics": "analytics",
  "/activity-log": "activity-log",
  "/help-center": "help",
  "/contact-support": "support",
  "/feedback": "support",
  "/community-guidelines": "support",
  "/privacy": "settings",
  "/terms": "settings",
  "/complete-profile": "auth",
  "/setup": "auth",
  "/login": "auth",
  "/signup": "auth",
  "/forgot-password": "auth",
};

/** Prefix routes, longest-first so `/chat/` can't be shadowed by `/c`. */
const PREFIXES: [string, string][] = [
  ["/chat/", "chat"],
  ["/u/", "public-profile"],
  ["/admin", "settings"],
];

/** Query values we're willing to forward, per page. Anything else is dropped. */
const ALLOWED_SECTIONS: Record<string, string[]> = {
  friends: ["discover", "active", "requests", "friends"],
};

/**
 * Resolves a pathname (and optionally the `tab` search param) to page context.
 *
 * Returns an empty object rather than a guess for anything unrecognised — the
 * assistant answers perfectly well without page context, and a wrong label is
 * worse than none because it biases the answer toward the wrong screen.
 */
export function pageContextFor(pathname: string | null, tab?: string | null): AiPageContext {
  if (!pathname) return {};

  // Trailing slashes and casing come from links and deep links, not from users.
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "").toLowerCase() : pathname;

  let page = EXACT[path];

  if (!page) {
    for (const [prefix, label] of PREFIXES) {
      if (path.startsWith(prefix)) {
        page = label;
        break;
      }
    }
  }

  if (!page) return {};

  const allowed = ALLOWED_SECTIONS[page];
  const section = tab && allowed?.includes(tab.toLowerCase()) ? tab.toLowerCase() : undefined;

  return section ? { page, section } : { page };
}

/**
 * Routes the assistant deliberately stays off.
 *
 * Two different reasons, kept in one list because the answer is the same:
 *  - Marketing and auth screens: the visitor isn't signed in, and Whispers AI is
 *    for signed-in users only.
 *  - `/u/<username>`: the anonymous send page. It's the one screen a stranger
 *    with no account uses, and dropping a signed-in assistant on top of it would
 *    be both confusing and a hint that the viewer has an account.
 *  - `/chat/<id>`: a full-screen thread whose composer, attachment sheet and
 *    voice recorder already own the bottom-right corner. A floating button
 *    there would sit on top of controls people are actively using.
 */
const HIDDEN_EXACT = new Set([
  "/",
  "/login",
  "/signup",
  "/forgot-password",
  "/setup",
  "/complete-profile",
]);

const HIDDEN_PREFIXES = ["/u/", "/chat/"];

export function assistantHiddenOn(pathname: string | null): boolean {
  if (!pathname) return true;

  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "").toLowerCase() : pathname;

  if (HIDDEN_EXACT.has(path)) return true;
  return HIDDEN_PREFIXES.some((prefix) => path.startsWith(prefix));
}

/**
 * True where a bottom tab bar is on screen, so the floating button can sit
 * above it instead of on it.
 *
 * Mirrors the routes that render `<BottomNavigation />`. Kept as a list rather
 * than measured at runtime because the nav is `position: fixed` inside a
 * `pointer-events-none` wrapper — there is nothing reliable to measure, and a
 * ResizeObserver on a fixed element that never changes size is worse than a
 * list that's checked when a route is added.
 */
const NAV_ROUTES = new Set([
  "/dashboard",
  "/discover",
  "/inbox",
  "/notifications",
  "/profile",
  "/premium",
  "/friends",
  "/public-feed",
  "/analytics",
  "/appearance",
]);

export function hasBottomNav(pathname: string | null): boolean {
  if (!pathname) return false;
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "").toLowerCase() : pathname;
  return NAV_ROUTES.has(path);
}
