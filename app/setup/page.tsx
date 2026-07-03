"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";

export default function SetupPage() {
  const router = useRouter();

  const [username, setUsername] = useState("");
  const [userId, setUserId] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    async function loadUser() {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        router.push("/login");
        return;
      }

      setUserId(session.user.id);

      const { data } = await supabase
        .from("profiles")
        .select("username")
        .eq("id", session.user.id)
        .single();

      if (data?.username) {
        router.push("/dashboard");
      }
    }

    loadUser();
  }, [router]);

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();

    setLoading(true);

    const { error } = await supabase.from("profiles").upsert({
      id: userId,
      username,
      display_name: username,
    });

    setLoading(false);

    if (error) {
      alert(error.message);
      return;
    }

    router.push("/dashboard");
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#090014] via-[#170033] to-[#02000A] text-white">
      <div className="w-full max-w-md rounded-3xl bg-white/10 backdrop-blur-xl p-8">

        <h1 className="text-4xl font-bold mb-2">
          Choose Username
        </h1>

        <p className="mb-8 text-gray-300">
          This becomes your Whisper profile link.
        </p>

        <form onSubmit={saveProfile} className="space-y-5">

          <input
            type="text"
            placeholder="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="w-full rounded-2xl bg-black/30 p-4 outline-none"
            required
          />

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-2xl bg-cyan-400 p-4 font-bold text-black"
          >
            {loading ? "Saving..." : "Continue"}
          </button>

        </form>

      </div>
    </main>
  );
}