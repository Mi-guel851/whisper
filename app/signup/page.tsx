"use client";

import { supabase } from "@/lib/supabase/client";
import { useToast } from "@/components/ToastProvider";
import GlassPanel from "@/components/GlassPanel";
import { Capacitor } from "@capacitor/core";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2 } from "lucide-react";

export default function SignupPage() {
  const { showToast } = useToast();
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function registerFcmToken() {
    const isNative = Capacitor.isNativePlatform();
    if (!isNative) return;

    try {
      const { PushNotifications } = await import("@capacitor/push-notifications");

      const permission = await PushNotifications.requestPermissions();
      if (permission.receive !== "granted") return;

      await PushNotifications.register();

      PushNotifications.addListener("registration", async (token) => {
        console.log("FCM Token:", token.value);

        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          await supabase
            .from("profiles")
            .update({ fcm_token: token.value })
            .eq("id", user.id);
        }
      });

      PushNotifications.addListener("registrationError", (err) => {
        console.error("FCM registration error:", err);
      });

    } catch (err) {
      console.error("Push notification setup failed:", err);
    }
  }

  async function signupWithGoogle() {
    setLoading(true);
    const isNative = Capacitor.isNativePlatform();

    if (isNative) {
      try {
        const { GoogleAuth } = await import("@codetrix-studio/capacitor-google-auth");

        await GoogleAuth.initialize({
          clientId: "226343458064-tq6nf31ekoos2h6r7dk4dc1o1cobaoh5.apps.googleusercontent.com",
          scopes: ["profile", "email"],
        });

        const googleUser = await GoogleAuth.signIn();

        const idToken = googleUser?.authentication?.idToken;
        if (!idToken) {
          showToast("Google sign-in failed. Please try again.");
          setLoading(false);
          return;
        }

        const { data, error } = await supabase.auth.signInWithIdToken({
          provider: "google",
          token: idToken,
        });

        if (error) {
          showToast(error.message);
          setLoading(false);
          return;
        }

        const { data: profile } = await supabase
          .from("profiles")
          .select("profile_completed")
          .eq("id", data.user?.id)
          .maybeSingle();

        await registerFcmToken();

        if (profile?.profile_completed) {
          router.push("/dashboard");
        } else {
          router.push("/complete-profile");
        }

      } catch (err: unknown) {
        setLoading(false);
        const message = err instanceof Error ? err.message : "Google sign-in was cancelled.";
        console.error("[Google Sign-In]", err);
        if (!message.toLowerCase().includes("cancel")) {
          showToast(message);
        }
      }
      return;
    }

    const redirectTo = `${window.location.origin}/complete-profile`;
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo },
    });

    if (error) {
      showToast(error.message);
      setLoading(false);
    }
  }

  return (
    <main className="relative min-h-screen overflow-hidden theme-bg-gradient flex items-center justify-center text-white px-4">

      <div className="absolute -top-40 -left-40 h-96 w-96 rounded-full bg-purple-600/20 blur-[150px]" />
      <div className="absolute bottom-0 right-0 h-[500px] w-[500px] rounded-full bg-purple-600/20 blur-[180px]" />

      <GlassPanel className="relative z-10 w-full max-w-md rounded-[2rem] border border-white/15 bg-white/10 p-8 text-center shadow-[0_24px_80px_rgba(0,0,0,0.28)] backdrop-blur-[32px]">

        <h1 className="text-4xl font-black">Create Account</h1>
        <p className="mt-2 mb-8 text-gray-300">
          Get your own Whisper link
        </p>

        <button
          onClick={signupWithGoogle}
          disabled={loading}
          className="w-full flex items-center justify-center gap-3 rounded-2xl bg-white p-4 font-black text-black hover:bg-gray-100 transition disabled:opacity-50"
        >
          {loading ? (
            <Loader2 className="animate-spin" />
          ) : (
            <svg width="20" height="20" viewBox="0 0 48 48">
              <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.4 29.3 35 24 35c-6.1 0-11-4.9-11-11s4.9-11 11-11c2.8 0 5.3 1 7.3 2.7l6-6C33.6 6.1 29 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.2-.1-2.4-.4-3.5z"/>
              <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.6 15.9 18.9 13 24 13c2.8 0 5.3 1 7.3 2.7l6-6C33.6 6.1 29 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/>
              <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.3 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.6 39.6 16.2 44 24 44z"/>
              <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.3-4.1 5.6l6.2 5.2C40.9 36.1 44 30.6 44 24c0-1.2-.1-2.4-.4-3.5z"/>
            </svg>
          )}
          {loading ? "Connecting..." : "Continue with Google"}
        </button>

      </GlassPanel>
    </main>
  );
}