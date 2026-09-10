"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Capacitor } from "@capacitor/core";
import { supabase } from "@/lib/supabase/client";

/**
 * Native deep links + OAuth callback, one entry point.
 *
 * WHAT CHANGED, AND WHY IT MATTERS
 *
 * This handler used to fish `access_token` / `refresh_token` out of the URL
 * (fragment or query) and feed them to `setSession` — the implicit flow, where
 * the user's long-lived credentials travel through the OS URL machinery:
 * browser history, Android's `appUrlOpen` intent extras, every proxy that ever
 * logs a redirect. Even un-logged, a link tapped from chat or an email is a
 * token delivered over an attacker-visible channel.
 *
 * The replacement is the PKCE code exchange: the redirect carries a
 * single-use, ~60-second, verifier-bound `?code=`, useless to anyone who
 * intercepts it without the challenge this webview generated. The handler
 * therefore accepts EXACTLY one credential-ish parameter, `code`, and any
 * URL that still carries `access_token`/`refresh_token` is refused outright —
 * logged as a stale-app hint rather than consumed, so an old server-side
 * redirect (implicit configured in the dashboard) fails loudly at the config
 * level instead of quietly re-opening the hole.
 *
 * Deep links gained the routes the notification paths actually emit
 * (`/public-feed?post=`, `/premium`, `/notifications`) and lost the
 * `whisperapp://feed → /feed` mapping that pointed at a route which does not
 * exist — every feed notification was silently 404-ing into a client-side
 * not-found.
 *
 * Nothing here logs URLs, hashes, codes, or session data — a fragment may
 * still carry one on an old OS, and "we don't log it" is a promise only this
 * file can keep.
 */
export default function AppUrlHandler() {
  const router = useRouter();

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    async function setupDeepLinks() {
      const { App } = await import("@capacitor/app");
      const { Browser } = await import("@capacitor/browser");

      const SAFE_ROUTE = /^\/[a-zA-Z0-9_\-./?=&%]*$/;

      function routeForUrl(url: URL): string | null {
        const host = url.host;
        const path = url.pathname;
        const postId = url.searchParams.get("post");
        const conversation = path.replace(/^\//, "");

        switch (host) {
          case "inbox":
            return "/inbox";
          case "chat":
            return conversation ? `/chat/${encodeURIComponent(conversation)}` : "/inbox";
          case "friends":
            return "/friends";
          case "feed":
            // The feed lives at /public-feed; /feed never existed.
            return postId && /^[0-9a-f-]{36}$/i.test(postId)
              ? `/public-feed?post=${encodeURIComponent(postId)}`
              : "/public-feed";
          case "wallet":
          case "coins":
            return "/premium";
          case "notifications":
            return "/notifications";
          case "complete-profile":
            // The OAuth redirect target — keep it reachable from the scheme.
            return "/complete-profile";
          case "dashboard":
            return "/dashboard";
          default:
            return null;
        }
      }

      async function handleUrl(urlStr: string) {
        // Never log callback URLs: fragments may still carry tokens on
        // deployments configured for the legacy implicit flow.

        let url: URL;
        try {
          url = new URL(urlStr);
        } catch {
          return;
        }

        // Force close any in-app browser — the flow is over either way.
        try {
          await Browser.close();
        } catch {
          /* Already closed. */
        }

        // 1. Navigation (from notifications).
        if (url.protocol === "whisperapp:") {
          const code = url.searchParams.get("code");

          if (code) {
            // 2. OAuth callback (PKCE). The code is single-use and bound to
            // the verifier this client generated; exchange it and nothing else.
            const errorParam = url.searchParams.get("error");
            if (errorParam) {
              // Provider-side refusal; the message is operator-facing at most.
              console.warn("[deeplink] OAuth provider returned an error, no exchange attempted");
              router.push("/login");
              return;
            }
            try {
              const { data, error } = await supabase.auth.exchangeCodeForSession(code);
              if (error) throw error;
              if (data.session) {
                router.push("/complete-profile");
              }
            } catch {
              console.warn("[deeplink] code exchange failed");
              router.push("/login");
            }
            return;
          }

          // Legacy implicit callbacks are REFUSED. The only thing they carry
          // that this client can act on is the problem itself: a token in a
          // URL. Fix it at the source (Auth → URL Configuration / the redirect
          // the app requests), not here.
          const params = new URLSearchParams(url.hash ? url.hash.slice(1) : "");
          if (url.searchParams.has("access_token") || params.has("access_token")) {
            console.error(
              "[deeplink] implicit-flow callback refused — this app must sign in through the PKCE (code) flow; update the deployment's Auth redirect configuration"
            );
            router.push("/login");
            return;
          }

          const route = routeForUrl(url);
          if (route && SAFE_ROUTE.test(route)) {
            router.push(route);
            return;
          }

          // Allow a plain https URL that IS one of our own routes (opened
          // from a web link in the app shell): /chat/<id>, /complete-profile…
          if (url.pathname && SAFE_ROUTE.test(url.pathname)) {
            if (url.pathname.includes("complete-profile")) {
              router.push("/complete-profile");
            }
          }
        }
      }

      // Handle the URL when the app is already open
      App.addListener("appUrlOpen", (data: { url: string }) => {
        void handleUrl(data.url);
      });

      // Handle the URL when the app is launched from a link
      App.getLaunchUrl()
        .then((launchUrl) => {
          if (launchUrl?.url) return handleUrl(launchUrl.url);
        })
        .catch(() => {});
    }

    void setupDeepLinks();
  }, [router]);

  return null;
}
