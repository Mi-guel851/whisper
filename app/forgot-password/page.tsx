"use client";

import { useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase/client";
import { useToast } from "@/components/ToastProvider";
import GlassPanel from "@/components/GlassPanel";
import { ChevronLeft, Mail } from "lucide-react";

export default function ForgotPasswordPage() {
  const { showToast } = useToast();

  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });

    setLoading(false);

    if (error) {
      showToast(error.message);
      return;
    }

    setSent(true);
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-gradient-to-br from-[#090014] via-[#170033] to-[#02000A] flex items-center justify-center text-white">
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

        {!sent ? (
          <>
            <h1 className="text-3xl font-black">Forgot password?</h1>
            <p className="mt-2 mb-8 text-gray-300">
              Enter your email and we&apos;ll send you a link to reset it.
            </p>

            <form onSubmit={handleSubmit} className="space-y-5">
              <input
                type="email"
                placeholder="Email Address"
                className="w-full rounded-2xl border border-white/10 bg-black/30 p-4 outline-none focus:border-cyan-400"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />

              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-2xl bg-gradient-to-r from-cyan-400 to-purple-500 p-4 font-bold text-black hover:opacity-90 disabled:opacity-60 transition"
              >
                {loading ? "Sending..." : "Send reset link"}
              </button>
            </form>
          </>
        ) : (
          <div className="text-center">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-cyan-400/15">
              <Mail size={28} className="text-cyan-300" />
            </div>
            <h1 className="mt-4 text-2xl font-bold">Check your email</h1>
            <p className="mt-2 text-gray-300">
              We sent a reset link to <span className="font-semibold text-white">{email}</span>.
              Click it to set a new password right away.
            </p>
          </div>
        )}
      </GlassPanel>
    </main>
  );
}