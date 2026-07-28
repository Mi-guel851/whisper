"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import html2canvas from "html2canvas-pro";
import { X, Download, Image as ImageIcon } from "lucide-react";
import { Capacitor } from "@capacitor/core";

type Platform = "instagram" | "snapchat" | "whatsapp" | "x" | "tiktok";

function PlatformIcon({ platform }: { platform: Platform }) {
 const paths: Record<Platform, React.ReactElement> = {
    instagram: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <rect x="3" y="3" width="18" height="18" rx="5" />
        <circle cx="12" cy="12" r="4" />
        <circle cx="17.2" cy="6.8" r="1" fill="currentColor" stroke="none" />
      </svg>
    ),
    snapchat: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
        <path d="M12 3c-3 0-5 2.2-5 5.2 0 1.6-.2 2.6-1 3.4-.6.6-1.5.9-2 1 0 .8.9 1.2 1.7 1.4.2.6.1 1.1.6 1.3.6.3 1.5-.1 2.2.2.7.3 1.1 1.5 3.5 1.5s2.8-1.2 3.5-1.5c.7-.3 1.6.1 2.2-.2.5-.2.4-.7.6-1.3.8-.2 1.7-.6 1.7-1.4-.5-.1-1.4-.4-2-1-.8-.8-1-1.8-1-3.4C17 5.2 15 3 12 3z" />
      </svg>
    ),
    whatsapp: (
      <svg viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 2a10 10 0 0 0-8.6 15L2 22l5.2-1.4A10 10 0 1 0 12 2zm0 18.2a8.1 8.1 0 0 1-4.2-1.2l-.3-.2-3.1.8.8-3-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1-.2.2-.6.8-.8 1-.1.2-.3.2-.5.1-.2-.1-1-.4-1.9-1.2-.7-.6-1.2-1.4-1.3-1.6-.1-.2 0-.4.1-.5.1-.1.2-.3.4-.4.1-.2.2-.3.2-.5.1-.2 0-.4 0-.5-.1-.1-.6-1.4-.8-1.9-.2-.5-.4-.4-.6-.4h-.5c-.2 0-.5.1-.7.3-.2.2-.9.9-.9 2.2s1 2.6 1.1 2.8c.1.2 2 3 4.7 4.2.7.3 1.2.5 1.6.6.7.2 1.3.2 1.7.1.5-.1 1.5-.6 1.8-1.2.2-.6.2-1.1.1-1.2-.1-.1-.2-.2-.4-.3z" />
      </svg>
    ),
    x: (
      <svg viewBox="0 0 24 24" fill="currentColor">
        <path d="M18.9 3H22l-7.2 8.2L23 21h-6.9l-5.4-6.6L4.5 21H1.4l7.7-8.8L1 3h7l4.9 6z" />
      </svg>
    ),
    tiktok: (
      <svg viewBox="0 0 24 24" fill="currentColor">
        <path d="M14 3c.3 1.8 1.5 3.2 3.3 3.7v2.4a6.4 6.4 0 0 1-3.3-1v6.4a5 5 0 1 1-4.3-5v2.5a2.6 2.6 0 1 0 1.8 2.5V3z" />
      </svg>
    ),
  };

  return paths[platform];
}

const PLATFORM_STYLES: Record<Platform, string> = {
  instagram: "bg-gradient-to-br from-fuchsia-500 via-pink-500 to-orange-400",
  snapchat: "bg-yellow-300 text-black",
  whatsapp: "bg-green-500",
  x: "bg-white text-black",
  tiktok: "bg-black border border-white/20",
};

function messageFontSize(length: number) {
  if (length <= 40) return "text-2xl";
  if (length <= 80) return "text-xl";
  if (length <= 140) return "text-lg";
  if (length <= 220) return "text-base";
  if (length <= 400) return "text-sm";
  return "text-xs";
}

export default function ShareMessageCard({
  message,
  imageUrl,
  onClose,
}: {
  message: string;
  imageUrl?: string | null;
  onClose: () => void;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [generating, setGenerating] = useState(false);
  const [toast, setToast] = useState("");

  function flashToast(text: string) {
    setToast(text);
    setTimeout(() => setToast(""), 2800);
  }

  async function getImageBlob(): Promise<Blob | null> {
    if (!cardRef.current) return null;
    const canvas = await html2canvas(cardRef.current, {
      backgroundColor: "#000000",
      scale: 3,
      useCORS: true,
      logging: false,
      width: cardRef.current.offsetWidth,
      height: cardRef.current.offsetHeight,
    });
    return new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/png", 1.0));
  }

  function downloadBlob(blob: Blob) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "whisper-message.png";
    link.click();
    URL.revokeObjectURL(url);
  }

  async function handleDownload() {
    setGenerating(true);
    const blob = await getImageBlob();
    setGenerating(false);
    if (!blob) return;

    if (Capacitor.isNativePlatform()) {
      try {
        const { Filesystem, Directory } = await import("@capacitor/filesystem");
        const { Share } = await import("@capacitor/share");

        const reader = new FileReader();
        reader.readAsDataURL(blob);
        reader.onloadend = async () => {
          const base64Data = (reader.result as string).split(",")[1];
          const fileName = `whisper-${Date.now()}.png`;

          try {
            const savedFile = await Filesystem.writeFile({
              path: fileName,
              data: base64Data,
              directory: Directory.Documents,
              recursive: true
            });

            await Share.share({
              title: "Save Whisper",
              text: "Anonymous Whisper",
              url: savedFile.uri,
            });

            flashToast("Image generated! 📥");
          } catch (writeErr) {
            console.error("Write error:", writeErr);
            flashToast("Permission error. Check app settings.");
          }
        };
      } catch (err) {
        console.error("Save error:", err);
        flashToast("Couldn't save image.");
      }
    } else {
      downloadBlob(blob);
      flashToast("Saved to your device 📥");
    }
  }

  async function handleSaveAttachment() {
    if (!imageUrl) return;
    setGenerating(true);

    try {
      const response = await fetch(imageUrl);
      const blob = await response.blob();

      if (Capacitor.isNativePlatform()) {
        const { Filesystem, Directory } = await import("@capacitor/filesystem");
        const { Share } = await import("@capacitor/share");

        const reader = new FileReader();
        reader.readAsDataURL(blob);
        reader.onloadend = async () => {
          const base64Data = (reader.result as string).split(",")[1];
          const fileName = `whisper-photo-${Date.now()}.jpg`;

          const savedFile = await Filesystem.writeFile({
            path: fileName,
            data: base64Data,
            directory: Directory.Documents,
            recursive: true
          });

          await Share.share({
            title: "Save Photo",
            url: savedFile.uri,
          });
          flashToast("Photo saved! 📷");
        };
      } else {
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = "whisper-photo.jpg";
        link.click();
        URL.revokeObjectURL(url);
        flashToast("Photo saved! 📷");
      }
    } catch (err) {
      console.error(err);
      flashToast("Couldn't save photo.");
    } finally {
      setGenerating(false);
    }
  }

  async function handlePlatformShare(platform: Platform) {
    setGenerating(true);
    const blob = await getImageBlob();
    setGenerating(false);
    if (!blob) return;

    const shareText = message
      ? `"${message}" — anonymous whisper 👻`
      : "I got an anonymous message on Whisper 👻";
    const shareUrl = "https://whisper.app";
    const file = new File([blob], "whisper-message.png", { type: "image/png" });

    if (Capacitor.isNativePlatform()) {
      try {
        const { Filesystem, Directory } = await import("@capacitor/filesystem");
        const { Share } = await import("@capacitor/share");

        const reader = new FileReader();
        reader.readAsDataURL(blob);
        reader.onloadend = async () => {
          const base64Data = (reader.result as string).split(",")[1];
          const fileName = `whisper-share-${Date.now()}.png`;

          const savedFile = await Filesystem.writeFile({
            path: fileName,
            data: base64Data,
            directory: Directory.Documents,
            recursive: true
          });

          await Share.share({
            title: "Whisper",
            text: shareText,
            url: savedFile.uri,
          });
        };
        return;
      } catch (err) {
        console.error("Native share error:", err);
      }
    }

    if (navigator.share && navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: "Whisper", text: shareText });
        return;
      } catch {
      }
    }

    downloadBlob(blob);
    flashToast("Image saved — attach it when sharing! 👻");

    if (platform === "whatsapp") {
      window.open(
        `https://wa.me/?text=${encodeURIComponent(`${shareText}\n${shareUrl}`)}`,
        "_blank"
      );
      return;
    }

    if (platform === "x") {
      window.open(
        `https://twitter.com/intent/tweet?text=${encodeURIComponent(
          shareText
        )}&url=${encodeURIComponent(shareUrl)}`,
        "_blank"
      );
      return;
    }

    const deepLinks: Record<string, string> = {
      instagram: "instagram://story-camera",
      snapchat: "snapchat://",
      tiktok: "tiktok://",
    };

    setTimeout(() => {
      window.location.href = deepLinks[platform];
    }, 500);
  }

  const platforms: Platform[] = ["instagram", "snapchat", "whatsapp", "x", "tiktok"];

  return (
    <div className="fixed inset-0 z-[999] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="relative w-full max-w-sm">
        <button
          onClick={onClose}
          className="absolute -top-12 right-0 text-white/70 hover:text-white"
        >
          <X size={28} />
        </button>

        <div className="max-h-[85vh] overflow-y-auto rounded-[2rem] bg-black">
          <div
            ref={cardRef}
            className="relative flex w-full flex-col overflow-hidden bg-black p-10 pt-16 pb-20"
          >
            {/* The actual card part */}
            <div className="relative flex flex-col overflow-hidden rounded-[2rem] bg-white shadow-2xl">
              {/* Header with Gradient */}
              <div className="bg-gradient-to-r from-cyan-400 to-purple-600 px-6 py-8 text-center">
                <h3 className="text-sm font-black uppercase tracking-wider text-white">
                  send me anonymous messages!
                </h3>
              </div>

              {/* Message Content */}
              <div className="flex min-h-[160px] flex-col items-center justify-center bg-white p-8 text-center">
                {message ? (
                  <p
                    className={`font-extrabold leading-tight text-[#1a1a1a] [overflow-wrap:anywhere] ${messageFontSize(
                      message.length
                    )}`}
                  >
                    {message}
                  </p>
                ) : (
                  <p className="text-lg font-bold text-gray-400 italic">No message text</p>
                )}

                {imageUrl && (
                  <img
                    src={imageUrl}
                    crossOrigin="anonymous"
                    alt="Anonymous attachment"
                    className="mt-6 max-h-[320px] w-auto max-w-full rounded-2xl object-contain shadow-md"
                  />
                )}
              </div>
            </div>

            {/* Branded Footer */}
            <div className="absolute bottom-6 left-0 right-0 flex flex-col items-center justify-center gap-1 opacity-90">
              <div className="flex items-center gap-1.5">
                <Image src="/ghost.png" alt="Whisper" width={28} height={28} className="drop-shadow-sm grayscale invert" />
                <span className="text-xl font-black tracking-tighter text-white">
                  Whisper
                </span>
              </div>
              <p className="text-[8px] font-bold uppercase tracking-[0.3em] text-gray-500">
                anonymous q&a
              </p>
            </div>
          </div>
        </div>

        <div className="mt-5 flex items-center justify-center gap-3">
          {platforms.map((platform) => (
            <button
              key={platform}
              onClick={() => handlePlatformShare(platform)}
              disabled={generating}
              className={`flex h-12 w-12 items-center justify-center rounded-full p-3 text-white transition hover:scale-110 disabled:opacity-50 ${PLATFORM_STYLES[platform]}`}
            >
              <PlatformIcon platform={platform} />
            </button>
          ))}
        </div>

        <button
          onClick={handleDownload}
          disabled={generating}
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl bg-white/10 p-4 font-black text-white transition hover:bg-white/20 disabled:opacity-50"
        >
          <Download size={18} />
          {generating ? "Generating..." : "Save share card"}
        </button>

        {imageUrl && (
          <button
            onClick={handleSaveAttachment}
            disabled={generating}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl border border-cyan-400/30 bg-cyan-400/10 p-4 font-black text-cyan-400 transition hover:bg-cyan-400/20 disabled:opacity-50"
          >
            <ImageIcon size={18} />
            {generating ? "Processing..." : "Save original photo"}
          </button>
        )}

        {toast && (
          <div className="absolute -bottom-14 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-white/10 px-4 py-2 text-xs font-semibold text-white backdrop-blur-md">
            {toast}
          </div>
        )}
      </div>
    </div>
  );
}