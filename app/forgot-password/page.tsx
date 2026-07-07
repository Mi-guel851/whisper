"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useToast } from "@/components/ToastProvider";
import GlassPanel from "@/components/GlassPanel";
import { ChevronLeft, KeyRound, Eye, EyeOff } from "lucide-react";

export default function ForgotPasswordPage() {
  const router = useRouter();
  const { showToast } = useToast();

  const [username, setUsername] = useState("");
  const [phrase, setPhrase] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (newPassword.length < 6) {
      showToast("Password must be at least 6 characters.");
      return;
    }

    if (newPassword !== confirmPassword) {
      showToast("Passwords don't match.");
      return;
    }

    setLoading(true);

    const res = await fetch("/api/reset-with-phrase", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, phrase, newPassword }),
    });

    const data = await res.json();
    setLoading(false);

    if (!res.ok) {
      showToast(data.error || "Something went wrong.");
      return;
    }

    showToast("Password updated! You can now log in. 🔒");
    router.push("/login");
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-gradient-to-br from-[#090014] via-[#170033] to-[#02000A] flex items-center justify-center text-white px-4">
      <div className="absolute -top-40 -left-40 h-96 w-96 rounded-full bg-cyan-500/20 blur-[150px]" />
      <div className="absolute bottom-0 right-0 h-[500px] w-[500px] rounded-full bg-purple-600/20 blur-[180px]" />

      <GlassPanel strong className="relative z-10 w-full max-w-md rounded-3xl p-8 mx-4">
        <Link
          href="/login"
          className="mb-6 flex items-center gap-1 text-sm font-semibold text-gray-400 hover:text-white"
        >
          <ChevronLeft size={16} />
          Back to login
        </Link>

        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-purple-500/15">
          <KeyRound size={26} className="text-purple-300" />
        </div>

        <h1 className="mt-4 text-center text-3xl font-black">Reset your password</h1>
        <p className="mt-2 mb-8 text-center text-gray-300">
          Enter your username and the recovery phrase you set when you signed up.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Username"
            required
            className="w-full rounded-2xl border border-white/10 bg-black/30 p-4 outline-none focus:border-cyan-400"
          />

          <input
            value={phrase}
            onChange={(e) => setPhrase(e.target.value)}
            placeholder="Recovery phrase"
            required
            className="w-full rounded-2xl border border-white/10 bg-black/30 p-4 outline-none focus:border-cyan-400"
          />

          <div className="relative">
            <input
              type={showPassword ? "text" : "password"}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="New password"
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

          <input
            type={showPassword ? "text" : "password"}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="Confirm new password"
            required
            className="w-full rounded-2xl border border-white/10 bg-black/30 p-4 outline-none focus:border-cyan-400"
          />

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-2xl bg-gradient-to-r from-cyan-400 to-purple-500 p-4 font-bold text-black hover:opacity-90 disabled:opacity-60 transition"
          >
            {loading ? "Resetting..." : "Reset password"}
          </button>
        </form>
      </GlassPanel>
    </main>
  );
}