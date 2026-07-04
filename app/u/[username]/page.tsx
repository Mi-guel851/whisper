"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { useToast } from "@/components/ToastProvider";

export default function PublicProfile() {
  const params = useParams();
  const username = params.username as string;
  const { showToast } = useToast();

  const [receiverId, setReceiverId] = useState("");
  const [checkingProfile, setCheckingProfile] = useState(true);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    async function loadProfile() {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, username")
        .eq("username", username)
        .single();

      if (error || !data) {
        setCheckingProfile(false);
        return;
      }

      // Save receiver id
      setReceiverId(data.id);

      // Record profile view (ignore duplicate errors)
      await supabase.from("profile_views").insert({
        profile_id: data.id,
      });

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

    showToast("🎉 Message sent anonymously!");

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
      <main className="min-h-screen flex items-center justify-center bg-[#090014] text-white px-6">
        <div className="text-center">
          <h1 className="text-4xl font-bold mb-3">
            User not found
          </h1>

          <p className="text-gray-400">
            @{username} doesn't exist on Whisper.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#090014] via-[#170033] to-[#02000A] text-white p-6">

      <div className="w-full max-w-lg rounded-3xl border border-white/10 bg-white/10 p-8 backdrop-blur-2xl">

        <h1 className="text-4xl font-bold">
          @{username}
        </h1>

        <p className="mt-2 text-gray-300">
          Send an anonymous message
        </p>

        {sent ? (
          <div className="mt-8 rounded-2xl border border-cyan-400/30 bg-cyan-500/10 p-6 text-center">

            <p className="text-2xl font-bold">
              🎉 Sent!
            </p>

            <p className="mt-2 text-gray-300">
              They'll never know it was you.
            </p>

            <button
              onClick={() => setSent(false)}
              className="mt-6 rounded-xl bg-cyan-400 px-5 py-3 font-bold text-black"
            >
              Send Another
            </button>

          </div>
        ) : (
          <form onSubmit={sendMessage} className="mt-8 space-y-5">

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