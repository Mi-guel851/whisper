"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { useToast } from "@/components/ToastProvider";

export default function SignupPage() {
  const router = useRouter();
  const { showToast } = useToast();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [loading, setLoading] = useState(false);

  async function signup() {
    const cleanUsername = username.trim().toLowerCase();

    if (!/^[a-z0-9_]{3,20}$/.test(cleanUsername)) {
      showToast("Username must be 3-20 characters: letters, numbers, underscores only.");
      return;
    }

    setLoading(true);

    // check username isn't already taken
    const { data: existing } = await supabase
      .from("profiles")
      .select("id")
      .eq("username", cleanUsername)
      .maybeSingle();

    if (existing) {
      setLoading(false);
      showToast("That username is already taken.");
      return;
    }

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { username: cleanUsername },
      },
    });

    setLoading(false);

    if (error) {
      showToast(error.message);
      return;
    }

    if (data.session) {
      showToast("Account created! Welcome to Whisper 🎉");
      router.push("/dashboard");
    } else {
      showToast("Confirmation email sent! Check your inbox to complete signup. 📧");
      router.push("/login");
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center text-white">
      <div className="w-full max-w-md space-y-4">

        <input
          className="w-full p-3 text-black"
          placeholder="email"
          onChange={(e) => setEmail(e.target.value)}
        />

        <input
          className="w-full p-3 text-black"
          placeholder="username"
          onChange={(e) => setUsername(e.target.value)}
        />

        <input
          className="w-full p-3 text-black"
          placeholder="password"
          type="password"
          onChange={(e) => setPassword(e.target.value)}
        />

        <button
          onClick={signup}
          disabled={loading}
          className="w-full bg-cyan-400 p-3 font-bold text-black disabled:opacity-60"
        >
          {loading ? "Creating..." : "Create Account"}
        </button>

      </div>
    </div>
  );
}