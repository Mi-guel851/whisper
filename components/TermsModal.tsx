"use client";

import { useState } from "react";
import Image from "next/image";
import { supabase } from "@/lib/supabase/client";
import { ShieldCheck, HeartHandshake, Ban } from "lucide-react";
import GlassPanel from "./GlassPanel";

export default function TermsModal({ onAccept }: { onAccept: () => void }) {
  const [loading, setLoading] = useState(false);

  async function handleAccept() {
    setLoading(true);

    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (session) {
      await supabase
        .from("profiles")
        .update({ terms_accepted: true })
        .eq("id", session.user.id);
    }

    setLoading(false);
    onAccept();
  }

  return (
    <div className="fixed inset-0 z-[999] flex items-center justify-center bg-black/85 backdrop-blur-sm p-4">
      <GlassPanel strong className="w-full max-w-md rounded-3xl p-8">
        <div className="flex flex-col items-center text-center">
          <Image src="/ghost.png" alt="Whisper" width={44} height={44} />
          <h1 className="mt-4 text-2xl font-black text-white">
            Before you whisper...
          </h1>
          <p className="mt-2 text-sm text-gray-400">
            Whisper is built on honesty and respect. By continuing, you agree to:
          </p>
        </div>

        <div className="mt-6 space-y-4">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-cyan-400/15">
              <HeartHandshake size={16} className="text-cyan-300" />
            </div>
            <p className="text-sm text-gray-300">
              Be kind. Anonymous doesn&apos;t mean cruel — treat every whisper the way you&apos;d want to be treated.
            </p>
          </div>

          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-purple-500/15">
              <Ban size={16} className="text-purple-300" />
            </div>
            <p className="text-sm text-gray-300">
              No harassment, threats, hate speech, or content meant to harm, expose, or embarrass someone.
            </p>
          </div>

          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-cyan-400/15">
              <ShieldCheck size={16} className="text-cyan-300" />
            </div>
            <p className="text-sm text-gray-300">
              Whisper isn&apos;t a place for scandals, rumors, or targeting anyone. It&apos;s for honest, respectful connection.
            </p>
          </div>
        </div>

        <button
          onClick={handleAccept}
          disabled={loading}
          className="mt-8 w-full rounded-2xl bg-gradient-to-r from-cyan-400 to-purple-500 p-4 font-bold text-black transition hover:opacity-90 disabled:opacity-60"
        >
          {loading ? "Confirming..." : "I Agree — Let's Whisper"}
        </button>

        <p className="mt-3 text-center text-xs text-gray-500">
          Violating these guidelines may result in account suspension.
        </p>
      </GlassPanel>
    </div>
  );
}