"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabase/client";

export default function PublicProfile() {
  const params = useParams();
  const username = params.username as string;

  const [receiverId, setReceiverId] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    async function loadProfile() {
      const { data } = await supabase
        .from("profiles")
        .select("id, username")
        .eq("username", username)
        .single();

      if (data) {
        setReceiverId(data.id);
      }
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
      alert(error.message);
      return;
    }

    alert("Message sent anonymously!");

    setMessage("");
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#090014] via-[#170033] to-[#02000A] text-white">
      <div className="w-full max-w-lg rounded-3xl bg-white/10 p-8 backdrop-blur-xl">

        <h1 className="text-4xl font-bold">@{username}</h1>

        <p className="mt-2 text-gray-300">
          Send an anonymous message
        </p>

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
            className="w-full rounded-2xl bg-cyan-400 p-4 font-bold text-black"
          >
            {loading ? "Sending..." : "Send Message"}
          </button>

        </form>

      </div>
    </main>
  );
}