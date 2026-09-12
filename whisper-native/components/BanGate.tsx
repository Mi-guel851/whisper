import { router, usePathname } from "expo-router";
import { useEffect } from "react";

import { useBanStatus } from "@/lib/bans";
import { useSession } from "@/lib/session";

/**
 * The ban gate — the native port of the web app's `components/BanGate.tsx`.
 *
 * Stops a banned account in its tracks: the moment `my_ban_status` says
 * banned, every route is replaced with `/banned`, which carries the full
 * explanation (reason, expiry, appeal) and is the only screen left reachable.
 * The server is the actual gate — bans live in triggers and RLS — so nothing
 * here has to be true for a banned account to be unable to act; this is the
 * reason the person finds out.
 *
 * The web keeps an allowlist of routes a banned user may still open (support,
 * legal, auth). Natively the banned screen itself carries those doors — the
 * support link opens the site's contact page in the browser — so one route
 * covers the same ground without a second screen a banned user can get lost
 * behind.
 */
export function BanGate() {
  const { userId } = useSession();
  const { banned, checking } = useBanStatus();
  const pathname = usePathname();

  useEffect(() => {
    if (!userId || checking || !banned) return;
    if (pathname === "/banned") return;
    router.replace("/banned");
  }, [banned, checking, pathname, userId]);

  return null;
}
