// LinkCard.tsx
"use client";

import { useEffect, useState } from "react";
import { Copy, Share2, Link2 } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { useToast } from "@/components/ToastProvider";
import SectionLoadingBar from "./SectionLoadingBar";
import GlassPanel from "./GlassPanel";

export default function LinkCard() {
  const [link, setLink] = useState("");
  const [loading, setLoading] = useState(true);
  const { showToast } = useToast();

  useEffect(() => {
    async function load() {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        setLoading(false);
        return;
      }

      const { data } = await supabase
        .from("profiles")
        .select("username")
        .eq("id", session.user.id)
        .single();

      if (data) {
        setLink(`${window.location.origin}/u/${data.username}`);
      }
      setLoading(false);
    }

    load();
  }, []);

  async function copyLink() {
    if (!link) return;
    await navigator.clipboard.writeText(link);
    showToast("Anonymous link copied! 🔗");
  }

  async function shareLink() {
    if (!link) return;
    if (navigator.share) {
      try {
        await navigator.share({
          title: "Send me anonymous messages",
          text: "Tap my Whisper link 👇",
          url: link,
        });
      } catch {
        // cancelled
      }
    } else {
      copyLink();
    }
  }

  return (
    <GlassPanel className="rounded-3xl p-6">
      <SectionLoadingBar loading={loading} />

      <div className="flex items-center gap-3">
        <div className="rounded-2xl bg-cyan-500/20 p-3">
          <Link2 className="text-cyan-300" size={24} />
        </div>
        <div>
          <h2 className="text-2xl font-bold text-white">Your Anonymous Link</h2>
          <p className="text-gray-400">Share it everywhere.</p>
        </div>
      </div>

      <div className="mt-6 rounded-2xl bg-black/30 p-4 break-all text-cyan-300">
        {link || "Generating link..."}
      </div>

      <div className="mt-5 flex gap-4">
        <button
          onClick={copyLink}
          className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-cyan-400 p-4 font-bold text-black hover:scale-105 transition"
        >
          <Copy size={20} />
          Copy
        </button>
        <button
          onClick={shareLink}
          className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-purple-600 p-4 font-bold text-white hover:scale-105 transition"
        >
          <Share2 size={20} />
          Share
        </button>
      </div>
    </GlassPanel>
  );
}