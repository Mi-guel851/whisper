"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase/client";

export default function SignupPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault();

    setLoading(true);

    const { error } = await supabase.auth.signUp({
      email,
      password,
    });

    setLoading(false);

    if (error) {
      alert(error.message);
      return;
    }

    alert("🎉 Account created successfully! Check your email if verification is enabled.");
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-gradient-to-br from-[#090014] via-[#170033] to-[#02000A] flex items-center justify-center text-white">

      {/* Background Glow */}
      <div className="absolute -top-40 -left-40 h-96 w-96 rounded-full bg-cyan-500/20 blur-[150px]" />
      <div className="absolute bottom-0 right-0 h-[500px] w-[500px] rounded-full bg-purple-600/20 blur-[180px]" />
      <div className="absolute top-1/2 left-1/2 h-80 w-80 -translate-x-1/2 -translate-y-1/2 rounded-full bg-pink-500/10 blur-[120px]" />

      {/* Glass Card */}
      <div className="relative z-10 w-full max-w-md rounded-3xl border border-white/10 bg-white/10 p-8 backdrop-blur-2xl shadow-2xl">

        <h1 className="mb-2 text-center text-4xl font-bold">
          Whisper
        </h1>

        <p className="mb-8 text-center text-gray-300">
          Create your anonymous messaging account
        </p>

        <form onSubmit={handleSignup} className="space-y-5">

          <input
            type="email"
            placeholder="Email Address"
            className="w-full rounded-2xl border border-white/10 bg-black/30 p-4 outline-none transition focus:border-cyan-400"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />

          <input
            type="password"
            placeholder="Password"
            className="w-full rounded-2xl border border-white/10 bg-black/30 p-4 outline-none transition focus:border-cyan-400"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-2xl bg-cyan-400 p-4 font-bold text-black transition hover:bg-cyan-300 disabled:opacity-60"
          >
            {loading ? "Creating Account..." : "Create Account"}
          </button>

        </form>

      </div>
    </main>
  );
}