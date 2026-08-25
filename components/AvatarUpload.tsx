"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Camera, Loader2, User } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { useToast } from "@/components/ToastProvider";
import { spring, tween } from "@/lib/motion";
import { useSafeReducedMotion } from "@/lib/useSafeReducedMotion";
import {
  CLOUDINARY_FOLDERS,
  CloudinaryUploadError,
  uploadToCloudinary,
} from "@/lib/cloudinary";

const MAX_BYTES = 5 * 1024 * 1024;

type AvatarUploadProps = {
  size?: number;
  /** Draws the surrounding panel. Off when it already sits inside a card. */
  framed?: boolean;
  onUploaded?: (url: string) => void;
};

/**
 * Avatar picker with optimistic preview.
 *
 * The local `URL.createObjectURL` preview swaps in before the upload starts,
 * so the new picture is on screen in one frame rather than after a round trip.
 * The object URL is revoked once the real one lands — leaking one per upload
 * pins the whole file in memory for the life of the tab.
 */
export default function AvatarUpload({
  size = 112,
  framed = false,
  onUploaded,
}: AvatarUploadProps) {
  const { showToast } = useToast();
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const reduced = useSafeReducedMotion();

  // Tracked so we can revoke it exactly once, on replacement or unmount.
  const objectUrl = useRef<string | null>(null);

  useEffect(() => {
    async function loadCurrentAvatar() {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) return;

      const { data } = await supabase
        .from("profiles")
        .select("avatar_url")
        .eq("id", session.user.id)
        .single();

      if (data?.avatar_url) {
        setAvatarUrl(data.avatar_url);
      }
    }

    loadCurrentAvatar();

    return () => {
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    };
  }, []);

  function releasePreview() {
    if (objectUrl.current) {
      URL.revokeObjectURL(objectUrl.current);
      objectUrl.current = null;
    }
  }

  async function upload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Reset immediately so picking the same file twice still fires `change`.
    event.target.value = "";
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      showToast("Please select an image file.", { variant: "error" });
      return;
    }

    if (file.size > MAX_BYTES) {
      showToast("Image must be under 5MB.", { variant: "error" });
      return;
    }

    releasePreview();
    const preview = URL.createObjectURL(file);
    objectUrl.current = preview;
    setAvatarUrl(preview);
    setLoading(true);

    /* Read before the upload rather than after it. The Cloudinary folder is
       `whisper/avatars/<uid>`, and that owner segment is what lets this picture
       be deleted later — so there is no upload to make without a session. */
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session) {
      setLoading(false);
      showToast("Please sign in again to change your picture.", { variant: "error" });
      return;
    }

    let url: string;
    try {
      const uploaded = await uploadToCloudinary(
        file,
        `${CLOUDINARY_FOLDERS.avatars}/${session.user.id}`
      );
      url = uploaded.url;
    } catch (error) {
      setLoading(false);
      showToast(
        error instanceof CloudinaryUploadError ? error.message : "Image upload failed.",
        { variant: "error" }
      );
      return;
    }

    const { error: updateError } = await supabase
      .from("profiles")
      .update({ avatar_url: url })
      .eq("id", session.user.id);

    setLoading(false);

    if (updateError) {
      showToast(updateError.message, { variant: "error" });
      return;
    }

    setAvatarUrl(url);
    releasePreview();
    onUploaded?.(url);
    showToast("Profile picture updated 👻", { variant: "success" });
  }

  const inner = (
    <div className="group relative" style={{ width: size, height: size }}>
      <motion.div
        className="relative h-full w-full overflow-hidden rounded-full"
        style={{
          border: "3px solid var(--theme-accent-purple)",
          boxShadow: "var(--elev-3)",
        }}
        whileHover={reduced ? undefined : { scale: 1.03 }}
        transition={spring.snappy}
      >
        <AnimatePresence mode="wait" initial={false}>
          {avatarUrl ? (
            <motion.img
              key={avatarUrl}
              src={avatarUrl}
              alt="Your profile picture"
              className="h-full w-full object-cover"
              initial={{ opacity: 0, scale: 1.04 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              transition={tween.base}
            />
          ) : (
            <motion.div
              key="placeholder"
              className="grid h-full w-full place-items-center"
              style={{
                background:
                  "linear-gradient(135deg, var(--theme-accent-purple), var(--theme-accent-pink))",
              }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={tween.fast}
            >
              <User size={size * 0.4} className="text-white" />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Dim + spinner while the bytes are in flight. Sits over the optimistic
            preview so it's obvious the picture isn't committed yet. */}
        <AnimatePresence>
          {loading && (
            <motion.div
              className="absolute inset-0 grid place-items-center"
              style={{ background: "rgba(0, 0, 0, 0.45)" }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={tween.fast}
            >
              <Loader2 size={26} className="animate-spin text-white" />
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      <label
        htmlFor="avatar-input"
        className="absolute bottom-0 right-0 grid h-10 w-10 cursor-pointer place-items-center rounded-full transition-transform duration-200 hover:scale-110 active:scale-95"
        style={{
          background:
            "linear-gradient(135deg, var(--theme-accent-from), var(--theme-accent-purple))",
          border: "2px solid var(--theme-bg)",
          boxShadow: "var(--elev-2)",
        }}
      >
        <Camera size={17} style={{ color: "#0b0016" }} />
        <span className="sr-only">Change profile picture</span>
      </label>

      <input
        id="avatar-input"
        type="file"
        accept="image/*"
        onChange={upload}
        disabled={loading}
        className="sr-only"
      />
    </div>
  );

  if (!framed) return inner;

  return (
    <div
      className="flex flex-col items-center gap-4 rounded-2xl p-6"
      style={{
        border: "1px solid var(--theme-glass-border)",
        background: "var(--theme-glass)",
      }}
    >
      {inner}
    </div>
  );
}
