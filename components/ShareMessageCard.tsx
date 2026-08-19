"use client";

import { useLayoutEffect, useRef, useState } from "react";
import html2canvas from "html2canvas-pro";
import { X, Download, Image as ImageIcon } from "lucide-react";
import { Capacitor } from "@capacitor/core";

type Platform = "instagram" | "snapchat" | "whatsapp" | "x" | "tiktok";

/* ---------------------------------------------------------------------------
   One layout, two sizes.

   Every measurement below is written against a 1080x1920 story canvas — the
   format Instagram, Snapchat and TikTok all expect — and multiplied by a single
   scale factor derived from however much room the preview actually has. So the
   preview and the exported PNG are the same layout rendered at two sizes, not
   two layouts that have to be kept in agreement by hand.

   That matters for more than tidiness. With fixed pixel sizes the message
   wrapped after a different word on a 360px phone than it did in the 1080px
   export, so the file never quite matched the card the user pressed save on.
   --------------------------------------------------------------------------- */
const CANVAS_W = 1080;
const CANVAS_H = 1920;

/** Left/right canvas margin, which lands the card at 864 wide. */
const CANVAS_PAD_X = 108;

/**
 * The Whisper ghost, drawn rather than loaded.
 *
 * The logo used to be `next/image` pointed at `/ghost.png` with `grayscale
 * invert` on top. html2canvas has to re-fetch that URL at capture time and
 * re-apply the filters itself, and when either step misses, the export lands
 * with a hole where the logo should be. Inline vector geometry has nothing to
 * fetch and no filter to emulate, so it rasterizes identically every time.
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

/**
 * Message type size, in canvas units.
 *
 * A photo and full-size text cannot both have the room they want inside a frame
 * whose height is fixed at 9:16. The text is what gives way, because it is the
 * part that can reflow — cropping the photo instead would damage the thing being
 * shared.
 */
function messageSize(length: number, hasImage: boolean): number {
  const ramp = [
    { max: 40, size: 70 },
    { max: 80, size: 58 },
    { max: 140, size: 47 },
    { max: 220, size: 39 },
    { max: 400, size: 31 },
  ];
  const base = ramp.find((step) => length <= step.max)?.size ?? 26;
  return hasImage ? Math.round(base * 0.78) : base;
}

/**
 * The thing that gets rasterized: a full story canvas, the card centred in it,
 * the Whisper watermark along the bottom.
 *
 * Two rules govern everything inside, both imposed by html2canvas rather than by
 * taste. It cannot rasterize `backdrop-filter`, so the glass has to be real
 * translucency compositing over the canvas gradient behind it. And it skips
 * `box-shadow` outright, so every lit edge is a gradient stop — a shadow-lit rim
 * shows in the preview and is simply absent from the saved file, which is how
 * the download used to come out flatter than what was on screen.
 */
function StoryFrame({
  message,
  imageUrl,
  width,
  frameRef,
}: {
  message: string;
  imageUrl?: string | null;
  width: number;
  frameRef: React.RefObject<HTMLDivElement | null>;
}) {
  /* One factor for the whole tree, applied as plain px in inline styles — so the
     computed values html2canvas reads are already absolute, with no container
     query or relative unit that could resolve differently inside its clone. */
  const s = width / CANVAS_W;
  const u = (n: number) => `${n * s}px`;
  const hasImage = Boolean(imageUrl);

  return (
    <div
      ref={frameRef}
      style={{
        /* Explicit pixels rather than `aspect-ratio` and flex: html2canvas lays
           its clone out in its own iframe, where an ancestor-dependent size can
           resolve to something else entirely. A stated size cannot drift. */
        width: `${width}px`,
        height: `${(width * CANVAS_H) / CANVAS_W}px`,
        position: "relative",
        overflow: "hidden",
        borderRadius: u(28),
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        /* Whisper's own night sky in place of the reference's flat charcoal —
           the same palette the rest of the app already sits on. */
        background: "linear-gradient(165deg, #0b1030 0%, #131c4b 38%, #201751 72%, #2a1748 100%)",
      }}
    >
      {/* Painted, never blurred — see the note on this component. */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(78% 42% at 12% 3%, rgba(34,211,238,0.22) 0%, rgba(34,211,238,0) 62%), " +
            "radial-gradient(84% 44% at 93% 70%, rgba(236,72,153,0.20) 0%, rgba(236,72,153,0) 64%), " +
            "radial-gradient(70% 38% at 50% 101%, rgba(139,92,246,0.20) 0%, rgba(139,92,246,0) 66%)",
        }}
      />

      {/* Card region. Takes the slack above the watermark, so the card lands in
          the same place whatever height it ends up at. */}
      <div
        style={{
          position: "relative",
          flex: "1 1 auto",
          minHeight: 0,
          width: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          padding: `${u(72)} ${u(CANVAS_PAD_X)} 0`,
        }}
      >
        {/* Weighted spacers rather than `justify-content: center`, because the
            reference sits its card in the upper third and dead-centre reads as a
            different composition. Uneven flex-grow on two zero-basis spacers
            gives that bias for a short card, and collapses to nothing once a tall
            photo needs the whole region — so biasing the layout costs a tall card
            no room, which a fixed top offset or an asymmetric padding would. */}
        <div aria-hidden style={{ flex: "1 1 0", minHeight: 0 }} />

        <div
          style={{
            width: "100%",
            flex: "0 1 auto",
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
            /* One rounded rectangle with the two halves flush inside it, which is
               the shape in the reference — not the two separately rounded panels
               with a gap between them that this used to be. */
            borderRadius: u(48),
            overflow: "hidden",
            border: `${u(2)} solid rgba(255,255,255,0.10)`,
          }}
        >
          {/* The prompt. Left-aligned and set large, as in the reference, so it
              reads as the invitation the card is built around rather than as a
              caption. The gradient is Whisper's cyan → purple → pink instead of
              the reference's pink → orange. */}
          <div
            style={{
              flexShrink: 0,
              minHeight: u(248),
              display: "flex",
              alignItems: "center",
              padding: `${u(52)} ${u(56)}`,
              background: "linear-gradient(118deg, #22d3ee 0%, #8b5cf6 52%, #ec4899 100%)",
            }}
          >
            <p
              style={{
                margin: 0,
                fontSize: u(46),
                lineHeight: 1.18,
                fontWeight: 900,
                letterSpacing: "-0.015em",
                color: "#ffffff",
              }}
            >
              send me anonymous messages!
            </p>
          </div>

          {/* The glass half. Translucent white compositing over the canvas
              gradient behind it — alpha blending, which rasterizes exactly,
              rather than a blur that would not. The first gradient layer is its
              top rim light, a stop rather than an inset shadow for the same
              reason. */}
          <div
            style={{
              position: "relative",
              flex: "1 1 auto",
              minHeight: u(330),
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: u(38),
              padding: `${u(64)} ${u(56)}`,
              textAlign: "center",
              background:
                `linear-gradient(to bottom, rgba(255,255,255,0.34) 0px, rgba(255,255,255,0) ${u(3)}), ` +
                "linear-gradient(160deg, rgba(255,255,255,0.16) 0%, rgba(255,255,255,0.085) 48%, rgba(255,255,255,0.055) 100%)",
            }}
          >
            {message ? (
              <p
                style={{
                  margin: 0,
                  fontSize: u(messageSize(message.length, hasImage)),
                  lineHeight: 1.32,
                  fontWeight: 800,
                  letterSpacing: "-0.01em",
                  color: "#ffffff",
                  overflowWrap: "anywhere",
                  textShadow: `0 ${u(2)} ${u(6)} rgba(4,8,26,0.42)`,
                }}
              >
                {message}
              </p>
            ) : hasImage ? null : (
              /* Only when there is genuinely nothing. A photo with no caption is
                 a complete whisper, so labelling it "no message" would be telling
                 the user their card is broken when it isn't. */
              <p
                style={{
                  margin: 0,
                  fontSize: u(38),
                  fontWeight: 700,
                  fontStyle: "italic",
                  color: "rgba(255,255,255,0.55)",
                }}
              >
                No message text
              </p>
            )}

            {imageUrl && (
              <img
                src={imageUrl}
                crossOrigin="anonymous"
                alt="Anonymous attachment"
                style={{
                  display: "block",
                  width: "auto",
                  maxWidth: "100%",
                  /* This is how the card adjusts to the photo: contain plus a
                     height ceiling, so a landscape shot makes a short wide card
                     and a portrait one makes a tall card, and neither can push
                     the watermark off the canvas. The ceiling is lower when there
                     is also text to fit. */
                  maxHeight: u(message ? 620 : 900),
                  objectFit: "contain",
                  borderRadius: u(32),
                  border: `${u(2)} solid rgba(255,255,255,0.18)`,
                }}
              />
            )}
          </div>
        </div>

        {/* Grows faster than the spacer above it, which is what lifts the card
            into the upper third. */}
        <div aria-hidden style={{ flex: "2.4 1 0", minHeight: 0 }} />
      </div>

      {/* Watermark, on the canvas rather than inside the card — the reference
          signs the story, not the message. */}
      <div
        style={{
          position: "relative",
          flexShrink: 0,
          width: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: u(20),
          padding: `${u(56)} 0 ${u(104)}`,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: u(16) }}>
          <GhostMark size={56 * s} />
          <span
            style={{
              fontSize: u(52),
              fontWeight: 900,
              letterSpacing: "-0.02em",
              lineHeight: 1,
              color: "#ffffff",
            }}
          >
            Whisper
          </span>
        </div>
        <p
          style={{
            margin: 0,
            fontSize: u(21),
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.42em",
            lineHeight: 1,
            color: "rgba(255,255,255,0.52)",
            /* Tracking adds a trailing gap after the last letter, which drags a
               centred line visibly left. Indenting by the same amount puts the
               optical centre back where the geometric one is. */
            textIndent: "0.42em",
          }}
        >
          anonymous q&amp;a
        </p>
      </div>
    </div>
  );
}

export default function ShareMessageCard({ message, imageUrl, onClose }: { message: string; imageUrl?: string | null; onClose: () => void }) {
  const cardRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [frameWidth, setFrameWidth] = useState(0);
  const [generating, setGenerating] = useState(false);
  const [toast, setToast] = useState("");

  /**
   * Fits the story frame to whatever height the modal has left over.
   *
   * The width is quantized to a multiple of 9 so that 16/9 lands on a whole
   * number of pixels on both sides. That makes the export exactly 1080x1920
   * rather than a pixel over, which matters because the story surfaces re-crop
   * anything that is not precisely 9:16.
   *
   * useLayoutEffect, not useEffect: measuring after paint would show one frame of
   * a wrongly-sized card. The component only ever mounts behind a client state
   * flag, so there is no server render for it to warn about.
   */
  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box) return;

    const measure = () => {
      const unit = Math.floor(Math.min(box.clientWidth / 9, box.clientHeight / 16));
      /* Below this the type is unreadable anyway — landscape on a short phone —
         so it renders nothing rather than a smudge. */
      const next = unit >= 8 ? unit * 9 : 0;
      setFrameWidth((prev) => (prev === next ? prev : next));
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => observer.disconnect();
  }, []);

  function flashToast(text: string) {
    setToast(text);
    setTimeout(() => setToast(""), 2800);
  }

  /**
   * Rasterizes the story frame.
   *
   * Capture used to run before webfonts and the attached photo had resolved, so
   * the text rendered in a fallback face and the photo could land as a blank
   * box. Both are waited on here.
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

    /* `offsetWidth` truncates to a whole pixel, which shaves the right and bottom
       edges of a fractionally-sized box. The frame is sized in whole pixels now,
       but rounding up costs nothing and keeps that from coming back if the sizing
       ever changes. */
    const rect = card.getBoundingClientRect();
    const width = Math.ceil(rect.width);
    const height = Math.ceil(rect.height);

    /* The frame lays out at a few hundred CSS px, so a 1:1 capture is a
       thumbnail — soft the moment it is posted full-bleed to a story, which is
       the whole reason the download read as low quality. Scaling to CANVAS_W
       lands it at exactly the 1080x1920 every social surface expects.
       iOS caps a canvas side at ~4096px and going over doesn't throw — it hands
       back an empty bitmap, which is what made tall cards download blank. So the
       target is a floor and the cap is a ceiling, and the ceiling wins. */
    const scale = Math.max(
      1,
      Math.min(CANVAS_W / width, 4096 / Math.max(width, height))
    );

    const canvas = await html2canvas(card, {
      /* Shows only through the frame's rounded corners, so it is the frame's own
         darkest stop rather than black — black is what put a hard dark frame
         around every exported share image. Not `null` either: a transparent PNG
         gets flattened to white or black by whichever app it lands in, which is
         the same bug with an extra step. */
      backgroundColor: "#0b1030",
      scale,
      useCORS: true,
      logging: false,
      width,
      height,
      /* The frame is inside a flex modal. Without pinning the scroll origin,
         html2canvas measures against the document's scroll position and captures
         an offset region — a card sliced across the top with a band of empty
         background at the bottom. */
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
   * click: Firefox ignores a click on a detached anchor, and revoking the URL in
   * the same tick cancels the download in Chromium before it starts. Both
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
      className="fixed inset-0 z-[999] flex flex-col px-4"
      style={{
        /* Still a dimming scrim — a modal needs one to pull focus — but tinted
           into the palette instead of flat black, so the card reads as glass
           floating over the app rather than a cutout in a black sheet. */
        background: "radial-gradient(120% 90% at 50% 0%, rgba(24,20,64,0.82) 0%, rgba(6,8,24,0.9) 100%)",
        backdropFilter: "blur(24px)",
        WebkitBackdropFilter: "blur(24px)",
        paddingTop: "max(1rem, env(safe-area-inset-top))",
        paddingBottom: "max(1rem, env(safe-area-inset-bottom))",
        /* Over-constrains `inset-0` on purpose, so height wins and `bottom`
           is ignored. A fixed element's 100% resolves against the layout
           viewport, which on mobile Safari is taller than what you can see while
           the URL bar is expanded — that used not to matter when the card was
           simply centred, but now the save button is the last row of a column and
           would sit below the fold. `dvh` tracks the visible height instead. */
        height: "100dvh",
      }}
    >
      <div className="pointer-events-none absolute top-0 left-0 h-96 w-96 rounded-full bg-purple-600/25 blur-[120px]" />
      <div className="pointer-events-none absolute bottom-0 right-0 h-96 w-96 rounded-full bg-cyan-500/20 blur-[120px]" />

      {/* A flex column rather than a centred block. The story frame is 9:16 and
          has to share a phone screen with the platform row and the save buttons,
          so it takes the leftover height instead of a guessed one. */}
      <div className="relative mx-auto flex h-full w-full max-w-sm flex-col">
        <div className="mb-3 flex shrink-0 justify-end">
          <button onClick={onClose} aria-label="Close" className="flex h-9 w-9 items-center justify-center rounded-full transition" style={{ background: "rgba(255,255,255,0.12)", border: "1px solid rgba(255,255,255,0.2)", backdropFilter: "blur(12px)", color: "white" }}>
            <X size={18} />
          </button>
        </div>

        {/* The glass container the frame sits in. Outside the capture tree, so
            this one is free to use a real backdrop blur. */}
        <div
          className="relative flex min-h-0 flex-1 flex-col rounded-[2.25rem] p-3"
          style={{
            background: "linear-gradient(145deg, rgba(255,255,255,0.13) 0%, rgba(255,255,255,0.05) 60%, rgba(168,85,247,0.08) 100%)",
            backdropFilter: "blur(40px) saturate(200%)",
            WebkitBackdropFilter: "blur(40px) saturate(200%)",
            border: "1px solid rgba(255,255,255,0.18)",
            boxShadow: "0 25px 50px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.2), inset 0 -1px 0 rgba(255,255,255,0.05)",
          }}
        >
          <div ref={boxRef} className="flex min-h-0 flex-1 items-center justify-center overflow-hidden">
            {frameWidth > 0 && (
              <StoryFrame message={message} imageUrl={imageUrl} width={frameWidth} frameRef={cardRef} />
            )}
          </div>
        </div>

        <div className="mt-4 flex shrink-0 items-center justify-center gap-3">
          {platforms.map((platform) => (
            <button key={platform} onClick={() => handlePlatformShare(platform)} disabled={generating} aria-label={`Share to ${platform}`} className={`flex h-12 w-12 items-center justify-center rounded-full p-3 text-white transition hover:scale-110 disabled:opacity-50 ${PLATFORM_STYLES[platform]}`}>
              <PlatformIcon platform={platform} />
            </button>
          ))}
        </div>

        <div className="mt-3 shrink-0">
          <button onClick={handleDownload} disabled={generating} className="flex w-full items-center justify-center gap-2 rounded-2xl p-4 font-black transition hover:opacity-90 disabled:opacity-50" style={{ background: "rgba(255,255,255,0.10)", border: "1px solid rgba(255,255,255,0.15)", color: "#ffffff" }}>
            <Download size={18} /> {generating ? "Generating..." : "Save share card"}
          </button>

          {imageUrl && <button onClick={handleSaveAttachment} disabled={generating} className="mt-2.5 flex w-full items-center justify-center gap-2 rounded-2xl p-4 font-black transition hover:opacity-90 disabled:opacity-50" style={{ background: "rgba(34,211,238,0.08)", border: "1px solid rgba(34,211,238,0.25)", color: "#22d3ee" }}><ImageIcon size={18} /> {generating ? "Processing..." : "Save original photo"}</button>}

          {toast && <div className="mt-2.5 flex w-full items-center justify-center rounded-full px-4 py-2 text-xs font-semibold" style={{ background: "rgba(255,255,255,0.10)", backdropFilter: "blur(12px)", border: "1px solid rgba(255,255,255,0.15)", color: "#ffffff" }}>{toast}</div>}
        </div>
      </div>
    </div>
  );
}
