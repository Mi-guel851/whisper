"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { useToast } from "@/components/ToastProvider";

export default function PublicProfile() {
  const params = useParams();
  const router = useRouter();
  const username = params.username as string;
  const { showToast } = useToast();

  const [receiverId, setReceiverId] = useState("");
  const [checkingProfile, setCheckingProfile] = useState(true);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    async function loadProfile() {
      const { data } = await supabase
        .from("profiles")
        .select("id, username")
        .eq("username", username)
        .single();

      if (data) {
        setReceiverId(data.id);
        await supabase.from("profile_views").insert({ profile_id: data.id });
      }
      setCheckingProfile(false);
    }

    loadProfile();
  }, [username]);

  async function sendMessage(e: React.FormEvent) {
    e.preventDefault();
    if (!receiverId) return;

    setLoading(true);

    const { error } = await supabase.from("messages").insert({
      recipient_id: receiverId,
      message,
    });

    setLoading(false);

    if (error) {
      showToast(error.message);
      return;
    }

    showToast("Message sent anonymously! 🎉");
    setMessage("");
    setSent(true);
  }

  if (checkingProfile) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-[#090014] text-white">
        <p className="text-gray-400">Loading...</p>
      </main>
    );
  }

  if (!receiverId) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-[#090014] text-white text-center px-6">
        <div>
          <h1 className="text-3xl font-bold mb-2">User not found</h1>
          <p className="text-gray-400">@{username} doesn&apos;t exist on Whisper.</p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#090014] via-[#170033] to-[#02000A] text-white px-4">
      <div className="w-full max-w-lg rounded-3xl bg-white/10 p-8 backdrop-blur-xl">

        <h1 className="text-4xl font-bold">@{username}</h1>

        <p className="mt-2 text-gray-300">
          Send an anonymous message
        </p>

        {sent ? (
          <div className="mt-8 space-y-6">
            <div className="rounded-2xl bg-cyan-500/10 border border-cyan-400/30 p-6 text-center">
              <p className="text-lg font-semibold">Sent! 🎉</p>
              <p className="text-gray-400 text-sm mt-1">
                Completely anonymous — they&apos;ll never know it was you.
              </p>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setSent(false)}
                className="flex-1 rounded-2xl bg-white/10 p-4 font-semibold text-white hover:bg-white/20 transition"
              >
                Send another
              </button>
              <button
                onClick={() => router.push("/signup")}
                className="flex-1 rounded-2xl bg-gradient-to-r from-purple-600 to-cyan-400 p-4 font-bold text-black hover:opacity-90 transition"
              >
                Create your own link
              </button>
            </div>

            <p className="text-center text-xs text-gray-500">
              👻 Get your own Whisper link and start receiving anonymous messages too.
            </p>
          </div>
        ) : (
          <form onSubmit={sendMessage} className="space-y-5 mt-8">
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Type your anonymous message..."
              className="h-40 w-full rounded-2xl bg-black/30 p-4 outline-none"
              required
            />
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-2xl bg-cyan-400 p-4 font-bold text-black disabled:opacity-60"
            >
              {loading ? "Sending..." : "Send Message"}
            </button>
          </form>
        )}

      </div>
    </main>
  );
}