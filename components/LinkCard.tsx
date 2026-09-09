"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy, Share2, Link2 } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { copyText } from "@/lib/clipboard";
import { useToast } from "@/components/ToastProvider";
import SectionLoadingBar from "./SectionLoadingBar";
import EdgeLitCard from "./EdgeLitCard";
import Button from "./Button";

export default function LinkCard({ username }: { username?: string } = {}) {
  const [link, setLink] = useState("");
  const [displayPath, setDisplayPath] = useState("");
  const [loading, setLoading] = useState(true);
  /* Copy feedback as button state rather than a toast. Copying your own link is
     something people do repeatedly, and a stack of "copied!" cards is noise the
     app does not need to make. The failure path still gets a toast, because a
     button that silently did nothing is worse than either. */
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { showToast } = useToast();

  useEffect(() => () => { if (copiedTimer.current) clearTimeout(copiedTimer.current); }, []);

  useEffect(() => {
    async function load() {
      if (username) {
        setLink(`${window.location.origin}/u/${username}`);
        setDisplayPath(`whisper.app/u/${username}`);
        setLoading(false);
        return;
      }

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

    void load();
  }, [username]);

  async function copyLink() {
    if (!link) return;
    const didCopy = await copyText(link);
    if (!didCopy) {
      showToast("Couldn't copy — long-press the link to copy it manually.");
      return;
    }

    setCopied(true);
    if (copiedTimer.current) clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setCopied(false), 1800);
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
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        await copyLink();
      }
    } else {
      await copyLink();
    }
  }

  return (
    <EdgeLitCard radius="3xl" intensity={0.45} speed={15} innerClassName="p-6">
      <SectionLoadingBar loading={loading} />

      <div>
        <div className="eyebrow flex items-center gap-2 text-cyan-400">
          <Link2 size={14} />
          <span>Your Whisper Link</span>
        </div>

        <h2 className="section-title mt-2 min-h-[3.4rem] text-white sm:min-h-0">
          Share it. Wait for honest replies.
        </h2>

        <div
          className="mt-5 flex items-center gap-2 rounded-2xl px-4 py-3"
          style={{ background: "var(--fill-1)", border: "1px solid var(--hairline)" }}
        >
          <Link2 size={16} className="shrink-0 text-gray-300" />
          <span className="truncate text-sm text-gray-200">
            {displayPath || "Generating link..."}
          </span>
        </div>

        <div className="mt-4 flex gap-3">
          <Button
            variant="secondary"
            className="flex-1"
            onClick={copyLink}
            disabled={!link}
            icon={copied ? <Check size={16} /> : <Copy size={16} />}
          >
            {copied ? "Copied" : "Copy"}
          </Button>
          <Button
            className="flex-1"
            onClick={shareLink}
            disabled={!link}
            icon={<Share2 size={16} />}
          >
            Share
          </Button>
        </div>
      </div>
    </EdgeLitCard>
  );
}