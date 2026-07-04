// app/complete-profile/page.tsx
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { useToast } from "@/components/ToastProvider";
import GlassPanel from "@/components/GlassPanel";
import { Eye, EyeOff } from "lucide-react";

export default function CompleteProfilePage() {
  const router = useRouter();
  const { showToast } = useToast();

  const [checking, setChecking] = useState(true);
  const [userId, setUserId] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    async function init() {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        router.push("/login");
        return;
      }

      const { data: profile } = await supabase
        .from("profiles")
        .select("username, profile_completed")
        .eq("id", session.user.id)
        .single();

      if (profile?.profile_completed) {
        router.push("/dashboard");
        return;
      }

      setUserId(session.user.id);
      setUsername(profile?.username || "");
      setChecking(false);
    }

    init();
  }, [router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const cleanUsername = username.trim().toLowerCase();

    if (!/^[a-z0-9_]{3,20}$/.test(cleanUsername)) {
      showToast("Username must be 3-20 characters: letters, numbers, underscores only.");
      return;
    }

    if (password.length < 6) {
      showToast("Password must be at least 6 characters.");
      return;
    }

    if (password !== confirmPassword) {
      showToast("Passwords don't match.");
      return;
    }

    setLoading(true);

    const { data: existing } = await supabase
      .from("profiles")
      .select("id")
      .eq("username", cleanUsername)
      .neq("id", userId)
      .maybeSingle();

    if (existing) {
      setLoading(false);
      showToast("That username is already taken.");
      return;
    }

    const { error: passError } = await supabase.auth.updateUser({ password });

    if (passError) {
      setLoading(false);
      showToast(passError.message);
      return;
    }

    const { error: profileError } = await supabase
      .from("profiles")
      .update({ username: cleanUsername, profile_completed: true })
      .eq("id", userId);

    setLoading(false);

    if (profileError) {
      showToast(profileError.message);
      return;
    }

    showToast("You're all set! 🎉");
    router.push("/dashboard");
  }

  if (checking) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-[#090014] text-white">
        <p className="text-gray-400">Loading...</p>
      </main>
    );
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-gradient-to-br from-[#090014] via-[#170033] to-[#02000A] flex items-center justify-center text-white px-4">

      <div className="absolute -top-40 -left-40 h-96 w-96 rounded-full bg-cyan-500/20 blur-[150px]" />
      <div className="absolute bottom-0 right-0 h-[500px] w-[500px] rounded-full bg-purple-600/20 blur-[180px]" />

      <GlassPanel strong className="relative z-10 w-full max-w-md rounded-3xl p-8">

        <h1 className="text-center text-3xl font-black">One last step</h1>
        <p className="mt-2 mb-8 text-center text-gray-300">
          Pick a username and set a password to finish setting up your account.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Username"
            required
            className="w-full rounded-2xl border border-white/10 bg-black/30 p-4 outline-none focus:border-cyan-400"
          />

          <div className="relative">
            <input
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Create a password"
              required
              className="w-full rounded-2xl border border-white/10 bg-black/30 p-4 pr-12 outline-none focus:border-cyan-400"
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

          <div className="relative">
            <input
              type={showConfirmPassword ? "text" : "password"}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Confirm password"
              required
              className="w-full rounded-2xl border border-white/10 bg-black/30 p-4 pr-12 outline-none focus:border-cyan-400"
            />
            <button
              type="button"
              onClick={() => setShowConfirmPassword((v) => !v)}
              className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white"
              tabIndex={-1}
            >
              {showConfirmPassword ? <EyeOff size={20} /> : <Eye size={20} />}
            </button>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-2xl bg-gradient-to-r from-purple-600 to-cyan-400 p-4 font-bold text-black disabled:opacity-60"
          >
            {loading ? "Saving..." : "Finish Setup"}
          </button>
        </form>

      </GlassPanel>
    </main>
  );
}