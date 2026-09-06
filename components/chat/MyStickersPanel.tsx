"use client";

/**
 * The "Created" tab: stickers the signed-in user has made, plus the maker
 * itself. Rows live in `user_stickers` (RLS: strictly own rows), bytes live
 * in Cloudinary under `whisper/stickers/<user-id>/…` — the same
 * owner-in-the-path convention as every other upload, which is what lets
 * /api/cloudinary/destroy authorize deletion when a sticker is removed.
 *
 * The maker is deliberately light: pick an image, pan/zoom it inside a
 * square 512 canvas, optionally add a caption, save. All processing is one
 * canvas on the client — no server round trips until the final upload.
 * WebP out where the browser can encode it (nearly everywhere), PNG as the
 * fallback; either way the longest edge is 512 so a created sticker is a
 * few tens of KB, never megabytes.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Plus, Trash2, Loader2, Sparkles, X, Check } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import {
  CLOUDINARY_FOLDERS,
  CloudinaryUploadError,
  discardCloudinaryUpload,
  uploadToCloudinary,
} from "@/lib/cloudinary";
import type { StickerDef } from "@/lib/chatMedia";

export type UserSticker = {
  id: string;
  user_id: string;
  name: string;
  media_url: string;
  mime_type: string;
  is_animated: boolean;
  width: number | null;
  height: number | null;
  created_at: string;
};

const STICKER_EDGE = 512;
const MAX_SOURCE_BYTES = 8 * 1024 * 1024;
const MAX_STICKERS = 60;

export default function MyStickersPanel({
  userId,
  onPick,
  sending,
  showToast,
}: {
  userId: string;
  onPick: (sticker: StickerDef) => void;
  sending: string | null;
  showToast: (message: string) => void;
}) {
  const [stickers, setStickers] = useState<UserSticker[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<UserSticker | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    supabase
      .from("user_stickers")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(MAX_STICKERS)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          console.error("[stickers] fetch failed:", error);
          setStickers([]);
          return;
        }
        setStickers((data as UserSticker[]) || []);
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  async function handleDelete(sticker: UserSticker) {
    setDeleting(true);
    try {
      const { error } = await supabase
        .from("user_stickers")
        .delete()
        .eq("id", sticker.id)
        .eq("user_id", userId);
      if (error) {
        showToast("Couldn't delete that sticker.");
        return;
      }
      setStickers((prev) => (prev || []).filter((s) => s.id !== sticker.id));
      /* Best-effort: the row is the source of truth, the asset is cleanup. */
      const { data: { session } } = await supabase.auth.getSession();
      void discardCloudinaryUpload(sticker.media_url, session?.access_token);
    } finally {
      setDeleting(false);
      setDeleteTarget(null);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-between px-4 pt-2 pb-1">
        <p className="chat-meta text-[11px] font-bold uppercase tracking-wider">My stickers</p>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-black transition active:scale-95"
          style={{
            background: "linear-gradient(135deg, var(--theme-accent-from), var(--theme-accent-to))",
            color: "var(--theme-accent-contrast)",
          }}
        >
          <Plus size={13} /> Create sticker
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        {stickers === null ? (
          <div className="grid grid-cols-4 gap-2 sm:grid-cols-5">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="skeleton aspect-square rounded-xl" aria-hidden />
            ))}
          </div>
        ) : stickers.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center px-6 text-center">
            <div className="empty-medallion mb-3 !h-14 !w-14">
              <Sparkles size={26} />
            </div>
            <p className="text-sm font-bold">Make it yours</p>
            <p className="chat-meta mt-1 max-w-[230px] text-xs">
              Turn any photo into a sticker you can send in every chat.
            </p>
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="chat-field mt-3 inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-bold"
            >
              <Plus size={13} /> Create your first sticker
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-4 gap-2 sm:grid-cols-5">
            {stickers.map((sticker) => {
              const isSending = sending === sticker.media_url;
              return (
                <div key={sticker.id} className="group relative aspect-square">
                  <button
                    type="button"
                    onClick={() =>
                      onPick({ id: sticker.id, url: sticker.media_url, name: sticker.name })
                    }
                    disabled={Boolean(sending)}
                    aria-label={`Send sticker: ${sticker.name}`}
                    title={sticker.name}
                    className="h-full w-full rounded-xl p-1.5 transition hover:bg-[var(--chat-icon-hover)] active:scale-90 disabled:opacity-70"
                  >
                    <img
                      src={sticker.media_url}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      className="h-full w-full object-contain"
                    />
                  </button>
                  {isSending && (
                    <span className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-xl bg-black/40">
                      <span className="h-5 w-5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => setDeleteTarget(sticker)}
                    aria-label={`Delete sticker: ${sticker.name}`}
                    className="absolute -right-1 -top-1 flex h-6 w-6 items-center justify-center rounded-full bg-rose-500/90 text-white opacity-0 shadow transition focus:opacity-100 group-hover:opacity-100 [@media(pointer:coarse)]:opacity-100"
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {creating && (
        <StickerMaker
          userId={userId}
          showToast={showToast}
          existingCount={stickers?.length ?? 0}
          onClose={() => setCreating(false)}
          onCreated={(sticker) => {
            setStickers((prev) => [sticker, ...(prev || [])]);
            setCreating(false);
          }}
        />
      )}

      {deleteTarget && (
        <div
          className="absolute inset-0 z-30 flex items-center justify-center bg-black/60 p-4"
          onClick={() => !deleting && setDeleteTarget(null)}
        >
          <div
            className="chat-chrome w-full max-w-[260px] rounded-2xl border p-4 text-center"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-sm font-black">Delete this sticker?</p>
            <img
              src={deleteTarget.media_url}
              alt=""
              className="mx-auto my-3 h-20 w-20 object-contain"
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                disabled={deleting}
                className="chat-field flex-1 rounded-xl py-2 text-xs font-bold"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleDelete(deleteTarget)}
                disabled={deleting}
                className="flex-1 rounded-xl bg-rose-500 py-2 text-xs font-black text-white disabled:opacity-60"
              >
                {deleting ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── The maker ───────────────────────────────────────────────────────────── */

function StickerMaker({
  userId,
  existingCount,
  showToast,
  onClose,
  onCreated,
}: {
  userId: string;
  existingCount: number;
  showToast: (message: string) => void;
  onClose: () => void;
  onCreated: (sticker: UserSticker) => void;
}) {
  const [image, setImage] = useState<ImageBitmap | HTMLImageElement | null>(null);
  const [isPngSource, setIsPngSource] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [caption, setCaption] = useState("");
  const [saving, setSaving] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragRef = useRef<{ startX: number; startY: number; baseX: number; baseY: number } | null>(null);

  /* Redraw whenever anything changes. One 256px preview canvas — cheap. */
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !image) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const size = canvas.width;
    ctx.clearRect(0, 0, size, size);
    const iw = image.width;
    const ih = image.height;
    const cover = Math.max(size / iw, size / ih) * zoom;
    const dw = iw * cover;
    const dh = ih * cover;
    ctx.drawImage(image, (size - dw) / 2 + offset.x, (size - dh) / 2 + offset.y, dw, dh);
    if (caption.trim()) drawCaption(ctx, size, caption.trim());
  }, [image, zoom, offset, caption]);

  useEffect(() => {
    draw();
  }, [draw]);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      showToast("Please choose an image file.");
      return;
    }
    if (file.size > MAX_SOURCE_BYTES) {
      showToast("Image too large — max 8MB.");
      return;
    }
    try {
      /* createImageBitmap applies EXIF orientation; fall back to <img> for
         formats it rejects (HEIC on some Androids). */
      let decoded: ImageBitmap | HTMLImageElement;
      try {
        decoded = await createImageBitmap(file, { imageOrientation: "from-image" });
      } catch {
        decoded = await decodeViaImg(file);
      }
      setImage(decoded);
      setIsPngSource(file.type === "image/png" || file.type === "image/webp");
      setZoom(1);
      setOffset({ x: 0, y: 0 });
    } catch {
      showToast("Couldn't read that image.");
    }
  }

  function onPointerDown(e: React.PointerEvent) {
    if (!image) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { startX: e.clientX, startY: e.clientY, baseX: offset.x, baseY: offset.y };
  }
  function onPointerMove(e: React.PointerEvent) {
    const drag = dragRef.current;
    if (!drag) return;
    setOffset({ x: drag.baseX + (e.clientX - drag.startX), y: drag.baseY + (e.clientY - drag.startY) });
  }
  function onPointerUp() {
    dragRef.current = null;
  }

  async function save() {
    if (!image || saving) return;
    if (existingCount >= MAX_STICKERS) {
      showToast(`You can keep up to ${MAX_STICKERS} stickers — delete one first.`);
      return;
    }
    setSaving(true);
    try {
      /* Re-render at full sticker size. The preview canvas is 256 for touch
         smoothness; the exported one is 512. */
      const out = document.createElement("canvas");
      out.width = STICKER_EDGE;
      out.height = STICKER_EDGE;
      const ctx = out.getContext("2d");
      if (!ctx) throw new Error("no canvas");
      const scale = STICKER_EDGE / (canvasRef.current?.width || 256);
      const iw = image.width;
      const ih = image.height;
      const cover = Math.max(STICKER_EDGE / iw, STICKER_EDGE / ih) * zoom;
      const dw = iw * cover;
      const dh = ih * cover;
      ctx.drawImage(
        image,
        (STICKER_EDGE - dw) / 2 + offset.x * scale,
        (STICKER_EDGE - dh) / 2 + offset.y * scale,
        dw,
        dh
      );
      if (caption.trim()) drawCaption(ctx, STICKER_EDGE, caption.trim());

      const blob = await encodeSticker(out);
      if (!blob) throw new Error("encode failed");

      const uploaded = await uploadToCloudinary(
        blob,
        `${CLOUDINARY_FOLDERS.stickers}/${userId}`,
        "sticker"
      );

      const name = caption.trim() || "My sticker";
      const { data, error } = await supabase
        .from("user_stickers")
        .insert({
          user_id: userId,
          name: name.slice(0, 64),
          media_url: uploaded.url,
          mime_type: blob.type === "image/webp" ? "image/webp" : "image/png",
          is_animated: false,
          width: STICKER_EDGE,
          height: STICKER_EDGE,
        })
        .select()
        .single();

      if (error || !data) {
        /* Roll the orphaned asset back, same pattern as photo sends. */
        const { data: { session } } = await supabase.auth.getSession();
        void discardCloudinaryUpload(uploaded.url, session?.access_token);
        showToast("Couldn't save the sticker. Please try again.");
        return;
      }

      showToast("Sticker created ✨");
      onCreated(data as UserSticker);
    } catch (error) {
      showToast(
        error instanceof CloudinaryUploadError ? error.message : "Couldn't create that sticker."
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="absolute inset-0 z-30 flex flex-col bg-[var(--chat-chrome)]">
      <div
        className="flex shrink-0 items-center justify-between border-b px-3 py-2"
        style={{ borderColor: "var(--chat-chrome-bd)" }}
      >
        <button
          type="button"
          onClick={onClose}
          disabled={saving}
          aria-label="Close sticker maker"
          className="chat-icon flex h-9 w-9 items-center justify-center rounded-full"
        >
          <X size={18} />
        </button>
        <p className="text-sm font-black">New sticker</p>
        <button
          type="button"
          onClick={() => void save()}
          disabled={!image || saving}
          aria-label="Save sticker"
          className="flex h-9 w-9 items-center justify-center rounded-full transition disabled:opacity-40"
          style={{
            background: image
              ? "linear-gradient(135deg, var(--theme-accent-from), var(--theme-accent-to))"
              : "var(--chat-field)",
            color: image ? "var(--theme-accent-contrast)" : "var(--chat-icon)",
          }}
        >
          {saving ? <Loader2 size={16} className="animate-spin" /> : <Check size={17} />}
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 overflow-y-auto p-4">
        <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />

        {!image ? (
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex h-44 w-44 flex-col items-center justify-center gap-2 rounded-3xl border-2 border-dashed text-sm font-bold transition hover:opacity-80"
            style={{ borderColor: "var(--chat-chrome-bd)", color: "var(--chat-meta)" }}
          >
            <Plus size={22} />
            Choose a photo
          </button>
        ) : (
          <>
            <div
              className="relative touch-none overflow-hidden rounded-3xl"
              style={{
                /* Checkerboard so transparency is visible while editing. */
                background:
                  "repeating-conic-gradient(rgba(127,127,127,0.18) 0% 25%, transparent 0% 50%) 0 0 / 20px 20px",
              }}
            >
              <canvas
                ref={canvasRef}
                width={256}
                height={256}
                className="block h-56 w-56 cursor-grab active:cursor-grabbing"
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
                aria-label="Sticker preview. Drag to reposition."
              />
            </div>

            <div className="w-full max-w-[280px]">
              <label className="chat-meta mb-1 block text-[11px] font-bold uppercase tracking-wider">
                Zoom
              </label>
              <input
                type="range"
                min={1}
                max={3}
                step={0.01}
                value={zoom}
                onChange={(e) => setZoom(Number(e.target.value))}
                className="w-full accent-[var(--theme-accent-purple)]"
                aria-label="Zoom sticker image"
              />
            </div>

            <div className="w-full max-w-[280px]">
              <input
                value={caption}
                onChange={(e) => setCaption(e.target.value.slice(0, 24))}
                placeholder="Add text (optional)"
                aria-label="Sticker text"
                className="chat-field w-full rounded-full px-4 py-2 text-sm outline-none placeholder:text-[var(--chat-meta)]"
              />
            </div>

            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="chat-meta text-xs font-semibold underline-offset-2 hover:underline"
            >
              Choose a different photo
            </button>
            {isPngSource && (
              <p className="chat-meta text-center text-[11px]">
                Transparent areas of your image are preserved.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function decodeViaImg(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("decode failed"));
    };
    img.src = url;
  });
}

/** WhatsApp-style caption: bold white with a dark outline, bottom-centered. */
function drawCaption(ctx: CanvasRenderingContext2D, size: number, text: string) {
  const fontSize = Math.max(18, Math.round(size / 9));
  ctx.font = `900 ${fontSize}px system-ui, -apple-system, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  ctx.lineJoin = "round";
  ctx.lineWidth = Math.max(4, fontSize / 5);
  ctx.strokeStyle = "rgba(0,0,0,0.85)";
  const x = size / 2;
  const y = size - Math.round(size / 18);
  ctx.strokeText(text, x, y, size - 24);
  ctx.fillStyle = "#ffffff";
  ctx.fillText(text, x, y, size - 24);
}

/** WebP first (small + keeps alpha); PNG when the browser can't encode it. */
function encodeSticker(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob(
      (webp) => {
        if (webp && webp.type === "image/webp") {
          resolve(webp);
          return;
        }
        canvas.toBlob((png) => resolve(png), "image/png");
      },
      "image/webp",
      0.9
    );
  });
}
