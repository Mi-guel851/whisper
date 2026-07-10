"use client";

import { useEffect, useState } from "react";
import { Copy, Share2, Link2 } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { useToast } from "@/components/ToastProvider";
import SectionLoadingBar from "./SectionLoadingBar";
import GlassPanel from "./GlassPanel";

export default function LinkCard() {
  const [link, setLink] = useState("");
  const [displayPath, setDisplayPath] = useState("");
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
        setDisplayPath(`whisper.app/u/${data.username}`);
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

      <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-purple-300">
        <Link2 size={14} />
        Your Whisper Link
      </div>

      <h2 className="mt-2 text-2xl font-black leading-snug text-white">
        Share it. Wait for the{" "}
        <span className="bg-gradient-to-r from-cyan-400 to-purple-400 bg-clip-text text-transparent">
          honest ones
        </span>
        .
      </h2>

      <div className="mt-5 flex items-center gap-2 rounded-2xl bg-black/30 px-4 py-3">
        <Link2 size={16} className="shrink-0 text-gray-300" />
        <span className="truncate text-sm text-gray-200">
          {displayPath || "Generating link..."}
        </span>
      </div>

      <div className="mt-4 flex gap-3">
        <button
          onClick={copyLink}
          className="flex flex-1 items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 py-3 font-semibold text-white transition hover:bg-white/10"
        >
          <Copy size={16} />
          Copy
        </button>
        <button
          onClick={shareLink}
          className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-purple-500 to-cyan-400 py-3 font-semibold text-black transition hover:scale-[1.02]"
        >
          <Share2 size={16} />
          Share
        </button>
      </div>
    </GlassPanel>
  );
}