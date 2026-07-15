"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Capacitor } from "@capacitor/core";
import { supabase } from "@/lib/supabase/client";

export default function AppUrlHandler() {
  const router = useRouter();

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    async function setupDeepLinks() {
      const { App } = await import("@capacitor/app");
      const { Browser } = await import("@capacitor/browser");

      async function handleUrl(urlStr: string) {
        console.log("[deeplink] Handling URL:", urlStr);

        // Force close any in-app browser
        try { await Browser.close(); } catch (e) {}

        const url = new URL(urlStr);

        // Check both hash (Supabase default) and search params
        const hash = url.hash.substring(1);
        const searchParams = url.searchParams;

        let accessToken = searchParams.get("access_token");
        let refreshToken = searchParams.get("refresh_token");

        if (hash) {
          const params = new URLSearchParams(hash);
          accessToken = accessToken || params.get("access_token");
          refreshToken = refreshToken || params.get("refresh_token");
        }

        if (accessToken && refreshToken) {
          console.log("[deeplink] Found tokens, setting session...");
          const { error } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });

          if (!error) {
            console.log("[deeplink] Session set, redirecting...");
            router.push("/complete-profile");
          } else {
            console.error("[deeplink] Error setting session:", error.message);
          }
        } else {
          console.log("[deeplink] No tokens found in URL");
          // If we just landed on complete-profile without tokens, maybe we're already logged in?
          if (url.pathname.includes("complete-profile")) {
             router.push("/complete-profile");
          }
        }
      }

      // Handle the URL when the app is already open
      App.addListener("appUrlOpen", (data: any) => {
        handleUrl(data.url);
      });

      // Handle the URL when the app is launched from a link
      App.getLaunchUrl().then((launchUrl) => {
        if (launchUrl?.url) {
          handleUrl(launchUrl.url);
        }
      });
    }

    setupDeepLinks();
  }, [router]);

  return null;
}