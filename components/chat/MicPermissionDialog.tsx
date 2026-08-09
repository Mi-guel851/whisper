"use client";

import { Mic } from "lucide-react";
import GlassPanel from "../GlassPanel";

export default function MicPermissionDialog({
  onConfirm,
  onCancel
}: {
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[3000] flex items-center justify-center bg-black/60 backdrop-blur-md p-6">
      <GlassPanel strong className="relative w-full max-w-sm rounded-3xl p-8 text-center border border-white/10 shadow-2xl">
        <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-purple-500/10 text-purple-400">
          <Mic size={40} />
        </div>

        <h2 className="text-2xl font-black text-white">Microphone Access</h2>
        <p className="mt-3 text-gray-400">
          Whisper needs microphone access to send voice notes.
        </p>

        <div className="mt-8 flex flex-col gap-3">
          <button
            onClick={onConfirm}
            className="w-full rounded-2xl bg-gradient-to-r from-cyan-400 to-purple-500 p-4 font-bold text-black shadow-lg shadow-cyan-500/20 active:scale-95 transition"
          >
            Grant Access
          </button>
          <button
            onClick={onCancel}
            className="w-full rounded-2xl bg-white/5 p-4 font-bold text-white active:scale-95 transition"
          >
            Maybe Later
          </button>
        </div>
      </GlassPanel>
    </div>
  );
}