"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { useToast } from "@/components/ToastProvider";
import GlassPanel from "@/components/GlassPanel";
import { Eye, EyeOff, KeyRound } from "lucide-react";

export default function ResetPasswordPage() {
  const router = useRouter();
  const { showToast } = useToast();

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // Supabase puts the recovery token in the URL hash and needs a moment
    // to exchange it for a valid session before updateUser() will work.
    const { data: listener } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        setReady(true);
      }
    });

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) setReady(true);
    });

    return () => {
      listener.subscription.unsubscribe();
    };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (password.length < 6) {
      showToast("Password must be at least 6 characters.");
      return;
    }

    if (password !== confirmPassword) {
      showToast("Passwords don't match.");
      return;
    }

    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);

    if (error) {
      showToast(error.message);
      return;
    }

    showToast("Password updated! You're all set 🔒");
    router.push("/dashboard");
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-gradient-to-br from-[#090014] via-[#170033] to-[#02000A] flex items-center justify-center text-white">
      <div className="absolute -top-40 -left-40 h-96 w-96 rounded-full bg-cyan-500/20 blur-[150px]" />
      <div className="absolute bottom-0 right-0 h-[500px] w-[500px] rounded-full bg-purple-600/20 blur-[180px]" />

      <GlassPanel strong className="relative z-10 w-full max-w-md rounded-3xl p-8 mx-4">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-purple-500/15">
          <KeyRound size={26} className="text-purple-300" />
        </div>

        <h1 className="mt-4 text-center text-3xl font-black">Set a new password</h1>
        <p className="mt-2 mb-8 text-center text-gray-300">
          Choose a new password for your account.
        </p>

        {!ready ? (
          <p className="text-center text-sm text-gray-400">
            Verifying your reset link...
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                placeholder="New password"
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

            <input
              type={showPassword ? "text" : "password"}
              placeholder="Confirm new password"
              className="w-full rounded-2xl border border-white/10 bg-black/30 p-4 outline-none focus:border-cyan-400"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
            />

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-2xl bg-gradient-to-r from-cyan-400 to-purple-500 p-4 font-bold text-black hover:opacity-90 disabled:opacity-60 transition"
            >
              {loading ? "Updating..." : "Update password"}
            </button>
          </form>
        )}
      </GlassPanel>
    </main>
  );
}