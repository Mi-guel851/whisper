// app/login/page.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase/client";
import { useToast } from "@/components/ToastProvider";
import GlassPanel from "@/components/GlassPanel";
import { Eye, EyeOff } from "lucide-react";
import { Capacitor } from "@capacitor/core";

export default function LoginPage() {
  const router = useRouter();
  const { showToast } = useToast();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  async function signupWithGoogle() {
    const isNative = Capacitor.isNativePlatform();

    if (isNative) {
      try {
        const { GoogleAuth } = await import("@capacitor-community/google-auth");
        const googleUser = await GoogleAuth.signIn();

        if (googleUser.authentication.idToken) {
          const { error } = await supabase.auth.signInWithIdToken({
            provider: 'google',
            token: googleUser.authentication.idToken,
          });

          if (error) {
            showToast(error.message);
          } else {
            router.push("/dashboard");
          }
          return;
        }
      } catch (err: any) {
        console.error(err);
        return;
      }
    }

    const redirectTo = `${window.location.origin}/complete-profile`;
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo,
      },
    });

    if (error) {
      showToast(error.message);
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
    router.push("/dashboard");
  }

  return (
    <main className="relative min-h-screen overflow-hidden theme-bg-gradient flex items-center justify-center text-white">

      <div className="absolute -top-40 -left-40 h-96 w-96 rounded-full bg-cyan-500/20 blur-[150px]" />
      <div className="absolute bottom-0 right-0 h-[500px] w-[500px] rounded-full bg-purple-600/20 blur-[180px]" />
      <div className="absolute top-1/2 left-1/2 h-80 w-80 -translate-x-1/2 -translate-y-1/2 rounded-full bg-pink-500/10 blur-[120px]" />

      <GlassPanel strong className="relative z-10 w-full max-w-md rounded-3xl p-8 mx-4">

        <h1 className="text-center text-4xl font-black">Welcome Back</h1>
        <p className="mt-2 mb-8 text-center text-gray-300">Login to your Whisper account</p>

        <form onSubmit={handleLogin} className="space-y-5">
          {/* Email/Password form items remain the same... */}
          <input
            type="email"
            placeholder="Email Address"
            className="w-full rounded-2xl border border-white/10 bg-black/30 p-4 outline-none focus:border-cyan-400"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />

          <div className="relative">
            <input
              type={showPassword ? "text" : "password"}
              placeholder="Password"
              className="w-full rounded-2xl border border-white/10 bg-black/30 p-4 pr-12 outline-none focus:border-cyan-400"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white"
              tabIndex={-1}
            >
              {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
            </button>
          </div>

          <div className="text-right -mt-2">
            <Link
              href="/forgot-password"
              className="text-sm font-semibold text-cyan-300 hover:text-cyan-200"
            >
              Forgot password?
            </Link>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-2xl bg-gradient-to-r from-cyan-400 to-purple-500 p-4 font-bold text-black hover:opacity-90 disabled:opacity-60 transition"
          >
            {loading ? "Logging In..." : "Login"}
          </button>
        </form>

        <div className="mt-6 flex items-center gap-4 text-gray-400">
          <div className="h-px flex-1 bg-white/10" />
          <span className="text-sm font-medium uppercase tracking-wider">or</span>
          <div className="h-px flex-1 bg-white/10" />
        </div>

        <button
          onClick={signupWithGoogle}
          className="mt-6 w-full flex items-center justify-center gap-3 rounded-2xl bg-white p-4 font-bold text-black hover:bg-gray-100 transition"
        >
          <svg width="20" height="20" viewBox="0 0 48 48">
            <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.4 29.3 35 24 35c-6.1 0-11-4.9-11-11s4.9-11 11-11c2.8 0 5.3 1 7.3 2.7l6-6C33.6 6.1 29 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.2-.1-2.4-.4-3.5z"/>
            <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.6 15.9 18.9 13 24 13c2.8 0 5.3 1 7.3 2.7l6-6C33.6 6.1 29 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/>
            <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.3 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.6 39.6 16.2 44 24 44z"/>
            <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.3-4.1 5.6l6.2 5.2C40.9 36.1 44 30.6 44 24c0-1.2-.1-2.4-.4-3.5z"/>
          </svg>
          Continue with Google
        </button>

        <p className="mt-8 text-center text-sm text-gray-400">
          Don&apos;t have an account?{" "}
          <Link href="/signup" className="font-bold text-cyan-300 hover:underline">
            Sign Up
          </Link>
        </p>
      </GlassPanel>
    </main>
  );
}