"use client";

import { supabase } from "@/lib/supabase/client";
import { safeErrorMessage } from "@/lib/safeErrorMessage";
import { useToast } from "@/components/ToastProvider";
import AuthShell, { AuthBrand } from "@/components/auth/AuthShell";
import ComingSoonGate from "@/components/auth/ComingSoonGate";
import GoogleMark from "@/components/auth/GoogleMark";
import { SIGNUPS_CLOSED } from "@/lib/signupGate";
import { grantConsent, markConsentPending } from "@/lib/consent";
import { Capacitor } from "@capacitor/core";
import { useRouter } from "next/navigation";
import { useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";

export default function SignupPage() {
  const { showToast } = useToast();
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  /* Unchecked by default on purpose: a pre-ticked box is a consent screen in
     name only. The button below stays disabled while it is unchecked, and the
     real gate is server-side (the profiles trigger in 202609090001 refuses to
     complete an account with no consent row), so this state is friction, not
     enforcement. */
  const [agreed, setAgreed] = useState(false);

  /* Return before any of the Google machinery is reachable.
     Not a disabled button: `signInWithOAuth` is what *creates* the account, so
     the correct place to stop is in front of the call, not on the control that
     happens to trigger it. See lib/signupGate.ts. */
  if (SIGNUPS_CLOSED) {
    return <ComingSoonGate />;
  }

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
          showToast(safeErrorMessage(error));
          setLoading(false);
          return;
        }

        /* The account exists now, so the consent row can be written here rather
           than on /complete-profile. Awaiting it (one cheap RPC) keeps the
           checkbox already ticked when onboarding continues. A failure must
           not fail the sign-in: the person just consented, and /complete-profile
           re-shows the checkbox if the row is missing. */
        if (agreed) {
          await grantConsent().catch(() => {});
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

    /* The OAuth round trip leaves the device and returns to /complete-profile
       with no React state left behind, so the tick travels as a sessionStorage
       flag that /complete-profile consumes when it writes the consent row. The
       flag is a hint only — the profiles trigger is the gate. The caller is
       only reachable with the box ticked (the button is disabled otherwise). */
    if (agreed) markConsentPending();

    const redirectTo = `${window.location.origin}/complete-profile`;
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo },
    });

    if (error) {
      showToast(safeErrorMessage(error));
      setLoading(false);
    }
  }

  return (
    <AuthShell>
      <AuthBrand />

      <h1 className="auth-title">Create Account</h1>
      <p className="auth-subtitle">Get your own Whisper link in seconds</p>

      <div className="mt-8 space-y-3">
        {/* `auth-check` is the form-checkbox treatment already used by the
            recovery-phrase confirmation, so the gate reads as part of the same
            form rather than a foreign widget. */}
        <label className="auth-check">
          <input
            type="checkbox"
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
          />
          <span>
            I agree to Whisper&apos;s{" "}
            <Link href="/privacy" className="auth-link">
              Privacy Policy
            </Link>{" "}
            and{" "}
            <Link href="/terms" className="auth-link">
              Terms
            </Link>
          </span>
        </label>

        <button
          onClick={signupWithGoogle}
          disabled={loading || !agreed}
          className="auth-google"
        >
          {loading ? <Loader2 size={20} className="animate-spin" /> : <GoogleMark />}
          {loading ? "Connecting..." : "Continue with Google"}
        </button>
      </div>

      <p className="auth-footnote">
        Already have an account?{" "}
        <Link href="/login" className="auth-link">
          Login
        </Link>
      </p>
    </AuthShell>
  );
}
