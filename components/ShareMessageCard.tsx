"use client";

import { useRef, useState } from "react";
import html2canvas from "html2canvas-pro";
import { X, Download, Image as ImageIcon } from "lucide-react";
import { Capacitor } from "@capacitor/core";

type Platform = "instagram" | "snapchat" | "whatsapp" | "x" | "tiktok";

/**
 * The Whisper ghost, drawn rather than loaded.
 *
 * The logo used to be `next/image` pointed at `/ghost.png` with `grayscale
 * invert` on top. html2canvas has to re-fetch that URL at capture time and
 * re-apply the filters itself, and when either step misses, the export lands
 * with a hole where the logo should be — the exact "errors" in the downloaded
 * card. Inline vector geometry has nothing to fetch and no filter to emulate,
 * so it rasterizes identically every time.
 */
function GhostMark({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 2.4c-4.05 0-7.05 3.03-7.05 7.05v9.06c0 .93 1.02 1.5 1.82 1.02l1.6-.96a1.2 1.2 0 0 1 1.26 0l1.36.82a1.2 1.2 0 0 0 1.24 0l1.36-.82a1.2 1.2 0 0 1 1.25 0l1.6.96c.8.48 1.82-.09 1.82-1.02V9.45c0-4.02-3.21-7.05-7.26-7.05Z"
        fill="#ffffff"
      />
      <ellipse cx="9.5" cy="10.1" rx="1.2" ry="1.55" fill="#16215c" />
      <ellipse cx="14.5" cy="10.1" rx="1.2" ry="1.55" fill="#16215c" />
    </svg>
  );
}

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

export default function ShareMessageCard({ message, imageUrl, onClose }: { message: string; imageUrl?: string | null; onClose: () => void }) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [generating, setGenerating] = useState(false);
  const [toast, setToast] = useState("");

  function flashToast(text: string) {
    setToast(text);
    setTimeout(() => setToast(""), 2800);
  }

  /**
   * Rasterizes the card.
   *
   * Two things used to make the download come out wrong rather than merely
   * ugly. Capture ran before webfonts and the attached photo had resolved, so
   * the text rendered in a fallback face and the photo could land as a blank
   * box; and a fixed `scale: 3` on a card carrying a tall attachment can exceed
   * the per-side canvas limit on iOS, where the browser hands back a silently
   * empty bitmap. Both are waited on and bounded here.
   */
  async function getImageBlob(): Promise<Blob | null> {
    const card = cardRef.current;
    if (!card) return null;

    await Promise.all([
      document.fonts?.ready?.catch(() => undefined),
      ...Array.from(card.querySelectorAll("img")).map((img) =>
        img.complete ? img.decode().catch(() => undefined) : new Promise<void>((resolve) => {
          img.onload = () => resolve();
          img.onerror = () => resolve();
        })
      ),
    ]);

    /* `offsetWidth` truncates to a whole pixel. The card is centred in a
       max-width column, so its real width is usually fractional — capturing at
       the truncated value shaves the right and bottom edges, which is where the
       thin dark seam along the exported card's border came from. Round up. */
    const rect = card.getBoundingClientRect();
    const width = Math.ceil(rect.width);
    const height = Math.ceil(rect.height);

    /* The card lays out around 340 CSS px, so a 1:1 capture is a thumbnail —
       it looks soft the moment it's posted full-bleed to a story, which is the
       whole reason the download reads as low quality next to NGL's. Scale up to
       a 1080px-wide export, the width every social surface expects.
       iOS caps a canvas side at ~4096px, and going over doesn't throw — it hands
       back an empty bitmap, which is what made tall cards download blank. So the
       target is a floor and the cap is a ceiling, and the ceiling wins. */
    const scale = Math.max(
      1,
      Math.min(Math.max(2, 1080 / width), 4096 / Math.max(width, height))
    );

    const canvas = await html2canvas(card, {
      /* The canvas fill only ever shows through the card's rounded corners, so
         it has to be the card's own blue rather than black — black is what put
         a hard dark frame around every exported share image. Not `null`
         either: a transparent PNG is flattened to white or black by whichever
         app it lands in, which is the same bug with an extra step. */
      backgroundColor: "#131c4b",
      scale,
      useCORS: true,
      logging: false,
      width,
      height,
      /* The card is inside a scrollable modal. Without pinning the scroll
         origin, html2canvas measures against the document's scroll position and
         captures an offset region — a card sliced across the top with a band of
         empty background at the bottom. */
      scrollX: 0,
      scrollY: 0,
      windowWidth: document.documentElement.clientWidth,
      windowHeight: document.documentElement.clientHeight,
    });

    /* `toBlob` hands back null when the canvas is tainted or allocation failed.
       Returning it as-is would surface as a silent no-op download, so the
       caller's null branch is the one that reports it. */
    return new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/png"));
  }

  /**
   * Saves a blob to disk.
   *
   * The link has to be in the document and the object URL has to outlive the
   * click: Firefox ignores a click on a detached anchor, and revoking the URL
   * in the same tick cancels the download in Chromium before it starts. Both
   * failure modes look identical to the user — the button does nothing.
   */
  function downloadBlob(blob: Blob, fileName = "whisper-message.png") {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    link.rel = "noopener";
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    setTimeout(() => {
      link.remove();
      URL.revokeObjectURL(url);
    }, 1000);
  }

  async function handleDownload() {
    setGenerating(true);
    const blob = await getImageBlob().catch((error) => {
      console.error("Share card render failed:", error);
      return null;
    });
    setGenerating(false);
    /* A failed render used to end in silence, so the button read as dead. */
    if (!blob) { flashToast("Couldn't build the card. Try again."); return; }

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
              recursive: true,
            });
            await Share.share({ title: "Save Whisper", text: "Anonymous Whisper", url: savedFile.uri });
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
          const savedFile = await Filesystem.writeFile({ path: fileName, data: base64Data, directory: Directory.Documents, recursive: true });
          await Share.share({ title: "Save Photo", url: savedFile.uri });
          flashToast("Photo saved! 📷");
        };
      } else {
        downloadBlob(blob, "whisper-photo.jpg");
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
    const blob = await getImageBlob().catch((error) => {
      console.error("Share card render failed:", error);
      return null;
    });
    setGenerating(false);
    if (!blob) { flashToast("Couldn't build the card. Try again."); return; }

    const shareText = message ? `"${message}" — anonymous whisper 👻` : "I got an anonymous message on Whisper 👻";
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
          const savedFile = await Filesystem.writeFile({ path: fileName, data: base64Data, directory: Directory.Documents, recursive: true });
          await Share.share({ title: "Whisper", text: shareText, url: savedFile.uri });
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
      } catch {}
    }

    downloadBlob(blob);
    flashToast("Image saved — attach it when sharing! 👻");

    if (platform === "whatsapp") {
      window.open(`https://wa.me/?text=${encodeURIComponent(`${shareText}\n${shareUrl}`)}`, "_blank");
      return;
    }
    if (platform === "x") {
      window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(shareUrl)}`, "_blank");
      return;
    }

    const deepLinks: Record<string, string> = { instagram: "instagram://story-camera", snapchat: "snapchat://", tiktok: "tiktok://" };
    setTimeout(() => {
      window.location.href = deepLinks[platform];
    }, 500);
  }

  const platforms: Platform[] = ["instagram", "snapchat", "whatsapp", "x", "tiktok"];

  return (
    <div
      className="fixed inset-0 z-[999] flex items-center justify-center p-4"
      style={{
        /* Still a dimming scrim — a modal needs one to pull focus — but tinted
           into the palette instead of flat black, so the card reads as glass
           floating over the app rather than a cutout in a black sheet. */
        background: "radial-gradient(120% 90% at 50% 0%, rgba(24,20,64,0.82) 0%, rgba(6,8,24,0.9) 100%)",
        backdropFilter: "blur(24px)",
        WebkitBackdropFilter: "blur(24px)",
      }}
    >
      <div className="pointer-events-none absolute top-0 left-0 h-96 w-96 rounded-full bg-purple-600/25 blur-[120px]" />
      <div className="pointer-events-none absolute bottom-0 right-0 h-96 w-96 rounded-full bg-cyan-500/20 blur-[120px]" />

      <div className="relative w-full max-w-sm">
        <button onClick={onClose} className="absolute -top-12 right-0 flex h-9 w-9 items-center justify-center rounded-full transition" style={{ background: "rgba(255,255,255,0.12)", border: "1px solid rgba(255,255,255,0.2)", backdropFilter: "blur(12px)", color: "white" }}>
          <X size={18} />
        </button>

        <div className="relative rounded-[2.5rem] p-5" style={{ background: "linear-gradient(145deg, rgba(255,255,255,0.13) 0%, rgba(255,255,255,0.05) 60%, rgba(168,85,247,0.08) 100%)", backdropFilter: "blur(40px) saturate(200%)", WebkitBackdropFilter: "blur(40px) saturate(200%)", border: "1px solid rgba(255,255,255,0.18)", boxShadow: "0 25px 50px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.2), inset 0 -1px 0 rgba(255,255,255,0.05)" }}>
          <div
            ref={cardRef}
            className="relative flex w-full flex-col overflow-hidden rounded-[2rem]"
            style={{
              /* The deep-blue rectangle *is* the card. It replaces the flat
                 black slab this used to be, which read as a hole punched in the
                 glass and exported as a black frame around every share image.

                 The top rim light is the first gradient layer rather than an
                 `inset` box-shadow, because html2canvas doesn't rasterize
                 box-shadow at all — the preview had a lit edge and the download
                 didn't, so the saved card always came out flatter than what the
                 user pressed save on. A gradient stop rasterizes exactly. */
              background:
                "linear-gradient(to bottom, rgba(255,255,255,0.16) 0px, rgba(255,255,255,0) 2px), linear-gradient(160deg, #0d1640 0%, #16215c 42%, #241a56 78%, #2b1a4e 100%)",
              border: "1px solid rgba(255,255,255,0.10)",
              padding: "24px 16px",
            }}
          >
            {/* Painted, not blurred: html2canvas can't rasterize backdrop-filter,
                so every glow in the capture tree has to be a real gradient or it
                exports as a grey box. */}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0"
              style={{
                background:
                  "radial-gradient(120% 70% at 12% 0%, rgba(34,211,238,0.20) 0%, rgba(34,211,238,0) 55%), radial-gradient(110% 65% at 92% 100%, rgba(192,68,145,0.22) 0%, rgba(192,68,145,0) 60%)",
              }}
            />

            <div className="relative overflow-hidden rounded-[1.5rem]" style={{ background: "linear-gradient(135deg, #22d3ee 0%, #a855f7 100%)", padding: "14px 20px", textAlign: "center" }}>
              <p style={{ fontSize: "11px", letterSpacing: "0.12em", fontWeight: 900, textTransform: "uppercase", color: "#ffffff", margin: 0 }}>send me anonymous messages!</p>
            </div>

            {/* The glass container. Translucent white over the blue below it —
                alpha compositing, which rasterizes exactly, rather than a blur
                that wouldn't. Its top and bottom edge lights are gradient stops
                for the same reason the card's are: html2canvas drops inset
                shadows, so a shadow-lit edge is an edge that vanishes on save. */}
            <div
              className="relative mt-3 overflow-hidden rounded-[1.5rem]"
              style={{
                background:
                  "linear-gradient(to bottom, rgba(255,255,255,0.30) 0px, rgba(255,255,255,0) 1.5px), linear-gradient(to top, rgba(0,0,0,0.20) 0px, rgba(0,0,0,0) 1.5px), linear-gradient(160deg, rgba(255,255,255,0.17) 0%, rgba(255,255,255,0.09) 46%, rgba(255,255,255,0.06) 100%)",
                border: "1px solid rgba(255,255,255,0.20)",
                minHeight: "160px",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                padding: "40px 32px",
                textAlign: "center",
              }}
            >
              {message ? (
                <p
                  className={`font-extrabold leading-snug [overflow-wrap:anywhere] ${messageFontSize(message.length)}`}
                  style={{ color: "#ffffff", margin: 0, textShadow: "0 1px 2px rgba(4,8,26,0.45)" }}
                >
                  {message}
                </p>
              ) : (
                <p style={{ fontSize: "18px", fontWeight: 700, fontStyle: "italic", color: "rgba(255,255,255,0.55)", margin: 0 }}>No message text</p>
              )}
              {/* No `shadow-md`: html2canvas skips box-shadow, so the drop shadow
                  showed in the preview and not in the file. A hairline border
                  separates the photo from the glass in both. */}
              {imageUrl && (
                <img
                  src={imageUrl}
                  crossOrigin="anonymous"
                  alt="Anonymous attachment"
                  className="mt-6 max-h-[300px] w-auto max-w-full rounded-2xl object-contain"
                  style={{ border: "1px solid rgba(255,255,255,0.16)" }}
                />
              )}
            </div>

            <div className="relative mt-5 flex flex-col items-center justify-center gap-1">
              <div className="flex items-center gap-2">
                <GhostMark />
                <span style={{ fontSize: "16px", fontWeight: 900, letterSpacing: "-0.02em", color: "#ffffff" }}>Whisper</span>
              </div>
              <p style={{ fontSize: "9px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.45em", color: "rgba(255,255,255,0.5)", margin: 0 }}>anonymous q&amp;a</p>
            </div>
          </div>

          <div className="mt-5 flex items-center justify-center gap-3">
            {platforms.map((platform) => (
              <button key={platform} onClick={() => handlePlatformShare(platform)} disabled={generating} className={`flex h-12 w-12 items-center justify-center rounded-full p-3 text-white transition hover:scale-110 disabled:opacity-50 ${PLATFORM_STYLES[platform]}`}>
                <PlatformIcon platform={platform} />
              </button>
            ))}
          </div>

          <div className="mt-4 flex gap-3">
            <button onClick={handleDownload} disabled={generating} className="flex w-full items-center justify-center gap-2 rounded-2xl p-4 font-black transition hover:opacity-90 disabled:opacity-50" style={{ background: "rgba(255,255,255,0.10)", border: "1px solid rgba(255,255,255,0.15)", color: "#ffffff" }}>
              <Download size={18} /> {generating ? "Generating..." : "Save share card"}
            </button>
          </div>

          {imageUrl && <button onClick={handleSaveAttachment} disabled={generating} className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl p-4 font-black transition hover:opacity-90 disabled:opacity-50" style={{ background: "rgba(34,211,238,0.08)", border: "1px solid rgba(34,211,238,0.25)", color: "#22d3ee" }}><ImageIcon size={18} /> {generating ? "Processing..." : "Save original photo"}</button>}

          {toast && <div className="mt-3 flex w-full items-center justify-center rounded-full px-4 py-2 text-xs font-semibold" style={{ background: "rgba(255,255,255,0.10)", backdropFilter: "blur(12px)", border: "1px solid rgba(255,255,255,0.15)", color: "#ffffff" }}>{toast}</div>}
        </div>
      </div>
    </div>
  );
}
