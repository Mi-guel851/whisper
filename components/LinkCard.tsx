"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";

export default function LinkCard() {
  const [link, setLink] = useState("");

  useEffect(() => {
    async function load() {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) return;

      const { data } = await supabase
        .from("profiles")
        .select("username")
        .eq("id", session.user.id)
        .single();

      if (data) {
        setLink(`${window.location.origin}/u/${data.username}`);
      }
    }

    load();
  }, []);

  async function copyLink() {
    await navigator.clipboard.writeText(link);
    alert("Link copied!");
  }

  return (
    <div className="mb-8 rounded-3xl border border-white/10 bg-white/10 p-6 backdrop-blur-xl">
      <p className="text-gray-400">Your Anonymous Link</p>

      <h2 className="mt-2 break-all text-lg font-bold text-cyan-300">
        {link}
      </h2>

      <button
        onClick={copyLink}
        className="mt-5 w-full rounded-2xl bg-cyan-400 p-4 font-bold text-black"
      >
        📋 Copy Link
      </button>
    </div>
  );
}