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

      // Handle the URL when it's opened while the app is running
      App.addListener("appUrlOpen", async (data: any) => {
        // Close the in-app browser immediately
        try { await Browser.close(); } catch (e) {}

        const url = new URL(data.url);

        // Supabase OAuth tokens are in the hash (#)
        // Expected format: whisperapp://complete-profile#access_token=...
        const hash = url.hash.substring(1);
        if (hash) {
          const params = new URLSearchParams(hash);
          const access_token = params.get("access_token");
          const refresh_token = params.get("refresh_token");

          if (access_token && refresh_token) {
            const { error } = await supabase.auth.setSession({
              access_token,
              refresh_token,
            });

            if (!error) {
              router.push("/complete-profile");
              return;
            }
          }
        }
      });
    }

    setupDeepLinks();
  }, [router]);

  return null;
}