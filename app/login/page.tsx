"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase/client";
import { useToast } from "@/components/ToastProvider";
import AuthShell, { AuthBrand } from "@/components/auth/AuthShell";
import AuthField from "@/components/auth/AuthField";
import GoogleMark from "@/components/auth/GoogleMark";
import { SIGNUPS_CLOSED } from "@/lib/signupGate";
import { Mail, Lock, Loader2 } from "lucide-react";
import { Capacitor } from "@capacitor/core";

export default function LoginPage() {
  const router = useRouter();
  const { showToast } = useToast();
  const [loadingGoogle, setLoadingGoogle] = useState(false);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
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

  async function signInWithGoogle() {
    /* Google is the same call on both screens: `signInWithOAuth` signs in an
       existing account and creates a new one, with nothing in the API to ask for
       only the first. So while signups are closed this button can't be offered
       here either — it would be the side door around /signup's gate.

       Email and password below are untouched, which is what keeps the test
       accounts working: those already exist, so they need no creation path. */
    if (SIGNUPS_CLOSED) {
      router.push("/signup");
      return;
    }

    setLoadingGoogle(true);
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
          showToast("Google sign-in failed. No token received.");
          setLoadingGoogle(false);
          return;
        }

        const { data, error } = await supabase.auth.signInWithIdToken({
          provider: "google",
          token: idToken,
        });

        if (error) {
          showToast(error.message);
          setLoadingGoogle(false);
          return;
        }

        const { data: profile } = await supabase
          .from("profiles")
          .select("profile_completed")
          .eq("id", data.user?.id)
          .maybeSingle();

        await registerFcmToken();

        router.push(profile?.profile_completed ? "/dashboard" : "/complete-profile");

      } catch (err: unknown) {
        setLoadingGoogle(false);
        const message = err instanceof Error ? err.message : "Google sign-in failed.";
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
      setLoadingGoogle(false);
    }
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);

    const { error } = await supabase.auth.signInWithPassword({ email, password });

    setLoading(false);

    if (error) {
      showToast(error.message);
      return;
    }

    showToast("Welcome back! 👋");
    await registerFcmToken();
    router.push("/dashboard");
  }

  return (
    <AuthShell>
      <AuthBrand />

      <h1 className="auth-title">Welcome Back</h1>
      <p className="auth-subtitle">Login to your Whisper account</p>

      <form onSubmit={handleLogin} className="mt-7 space-y-4">
        <AuthField
          label="Email"
          type="email"
          icon={Mail}
          value={email}
          onChange={setEmail}
          placeholder="you@example.com"
          autoComplete="email"
          inputMode="email"
          required
        />

        <div>
          <AuthField
            label="Password"
            type="password"
            icon={Lock}
            value={password}
            onChange={setPassword}
            placeholder="••••••••"
            autoComplete="current-password"
            required
          />

          <div className="mt-2 text-right">
            <Link href="/forgot-password" className="auth-link">
              Forgot password?
            </Link>
          </div>
        </div>

        <button type="submit" disabled={loading} className="auth-submit">
          {loading ? (
            <span className="inline-flex items-center gap-2">
              <Loader2 size={18} className="animate-spin" />
              Logging In...
            </span>
          ) : (
            "Login"
          )}
        </button>
      </form>

      {/* Hidden rather than disabled while signups are closed. A greyed-out
          Google button invites a tap and then explains nothing; the guard in
          `signInWithGoogle` stays as the backstop for any path that still
          reaches it. The divider goes with it — "or" with nothing after it. */}
      {!SIGNUPS_CLOSED && (
        <>
          <div className="auth-divider">
            <span>or</span>
          </div>

          <button onClick={signInWithGoogle} disabled={loadingGoogle} className="auth-google">
            {loadingGoogle ? <Loader2 size={20} className="animate-spin" /> : <GoogleMark />}
            {loadingGoogle ? "Connecting..." : "Continue with Google"}
          </button>
        </>
      )}

      <p className="auth-footnote">
        Don&apos;t have an account?{" "}
        <Link href="/signup" className="auth-link">
          Sign Up
        </Link>
      </p>
    </AuthShell>
  );
}
