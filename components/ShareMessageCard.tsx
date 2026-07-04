"use client";

import { useRef, useState } from "react";
import html2canvas from "html2canvas";
import { X, Download, Share2 } from "lucide-react";

export default function ShareMessageCard({
  message,
  onClose,
}: {
  message: string;
  onClose: () => void;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [generating, setGenerating] = useState(false);

  async function getImageBlob(): Promise<Blob | null> {
    if (!cardRef.current) return null;
    const canvas = await html2canvas(cardRef.current, {
      backgroundColor: null,
      scale: 2,
    });
    return new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/png"));
  }

  async function handleDownload() {
    setGenerating(true);
    const blob = await getImageBlob();
    setGenerating(false);
    if (!blob) return;

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "whisper-message.png";
    link.click();
    URL.revokeObjectURL(url);
  }

  async function handleShare() {
    setGenerating(true);
    const blob = await getImageBlob();
    setGenerating(false);
    if (!blob) return;

    const file = new File([blob], "whisper-message.png", { type: "image/png" });

    if (navigator.share && navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({
          files: [file],
          title: "Whisper",
          text: "I got an anonymous message on Whisper 👻",
        });
      } catch {
        // user cancelled — fine
      }
    } else {
      handleDownload();
    }
  }

  return (
    <div className="fixed inset-0 z-[999] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="relative w-full max-w-sm">

        <button
          onClick={onClose}
          className="absolute -top-12 right-0 text-white/70 hover:text-white"
        >
          <X size={28} />
        </button>

        {/* The actual shareable card */}
        <div
          ref={cardRef}
          className="rounded-3xl bg-gradient-to-br from-[#170033] via-[#0d0020] to-[#02000A] p-8 border border-white/10"
        >
          <div className="flex items-center gap-2 mb-8">
            <span className="text-2xl">👻</span>
            <span className="text-xl font-black text-white tracking-tight">Whisper</span>
          </div>

          <p className="text-2xl font-extrabold text-white leading-snug break-words">
            {message}
          </p>

          <p className="mt-8 text-sm text-gray-400">
            Anonymous message · whisper.app
          </p>
        </div>

        <div className="mt-5 flex gap-3">
          <button
            onClick={handleDownload}
            disabled={generating}
            className="flex-1 flex items-center justify-center gap-2 rounded-2xl bg-white/10 p-4 font-semibold text-white hover:bg-white/20 transition disabled:opacity-50"
          >
            <Download size={18} />
            Save
          </button>
          <button
            onClick={handleShare}
            disabled={generating}
            className="flex-1 flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-purple-600 to-cyan-400 p-4 font-bold text-black hover:opacity-90 transition disabled:opacity-50"
          >
            <Share2 size={18} />
            Share
          </button>
        </div>

      </div>
    </div>
  );
}