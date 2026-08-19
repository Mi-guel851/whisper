"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { motion, type Variants } from "framer-motion";
import { supabase } from "@/lib/supabase/client";
import { sanitizeGmailName } from "@/lib/coins";
import { useToast } from "@/components/ToastProvider";
import AmbientFloaters from "@/components/AmbientFloaters";
import { fadeUp, respectMotion, spring, tween } from "@/lib/motion";
import useSafeReducedMotion from "@/lib/useSafeReducedMotion";
import { ImagePlus, X, User } from "lucide-react";
import Image from "next/image";

/** The columns this page reads. One list, so the fetch and the realtime
 *  refetch can never drift apart and quietly stop showing a field. */
const PROFILE_COLUMNS = "id, username, avatar_url, display_name, bio";

type PublicProfileRow = {
  id: string;
  username: string;
  avatar_url: string | null;
  display_name: string | null;
  bio: string | null;
};

/**
 * The card's entrance doubles as the stagger parent, so the panel and its
 * contents arrive as one motion rather than two competing ones.
 *
 * Module scope, not inline: a fresh variants object on every render would
 * restart the cascade on each keystroke in the message box.
 */
const cardIn: Variants = {
  hidden: { opacity: 0, y: 18, scale: 0.985 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { ...spring.smooth, staggerChildren: 0.06, delayChildren: 0.04 },
  },
};

export default function PublicProfile() {
  const params = useParams();
  const username = params.username as string;
  const { showToast } = useToast();
  const reduced = useSafeReducedMotion();

  const [profile, setProfile] = useState<PublicProfileRow | null>(null);
  const [checkingProfile, setCheckingProfile] = useState(true);
  const [message, setMessage] = useState("");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const receiverId = profile?.id ?? "";
  const avatarUrl = profile?.avatar_url ?? null;
  const displayName = profile?.display_name ?? null;
  const bio = profile?.bio?.trim() || "";

  useEffect(() => {
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    async function loadProfile() {
      const { data } = await supabase
        .from("profiles")
        .select(PROFILE_COLUMNS)
        .eq("username", username)
        .single<PublicProfileRow>();

      if (cancelled) return;

      if (data) {
        setProfile(data);

        /* Subscribe by id rather than username, so the filter keeps matching if
           the owner renames themselves mid-visit — and so the row this page is
           actually showing is the only one it listens to.

           Filtered server-side: an unfiltered `profiles` subscription would push
           every profile edit in the app to every open link page. */
        channel = supabase
          .channel(`public-profile-${data.id}-${Date.now()}`)
          .on(
            "postgres_changes",
            {
              event: "UPDATE",
              schema: "public",
              table: "profiles",
              filter: `id=eq.${data.id}`,
            },
            (payload) => {
              if (cancelled) return;
              /* Merged rather than replaced. Realtime sends whatever the table's
                 REPLICA IDENTITY exposes, which is not guaranteed to be every
                 column this page selected — merging keeps the avatar from
                 blanking out on a bio-only edit. */
              setProfile((current) =>
                current
                  ? { ...current, ...(payload.new as Partial<PublicProfileRow>) }
                  : current
              );
            }
          )
          .subscribe();

        /* Fire-and-forget: a view count is not worth delaying first paint for,
           and awaiting it put a round trip in front of the send form. */
        void supabase.from("profile_views").insert({ profile_id: data.id });
      }

      setCheckingProfile(false);
    }

    loadProfile();

    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
    };
  }, [username]);

  function handleImageSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      showToast("Please select an image file.");
      return;
    }

    if (file.size > 1 * 1024 * 1024) {
      showToast("Image must be under 1MB.");
      return;
    }

    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
  }

  function removeImage() {
    setImageFile(null);
    setImagePreview(null);
  }

  async function sendMessage() {
    if (!receiverId) return;

    if (!message.trim() && !imageFile) {
      showToast("Write a message or attach an image.");
      return;
    }

    setLoading(true);

    let imageUrl: string | null = null;

    if (imageFile) {
      const fileExt = imageFile.name.split(".").pop();
      const filePath = `${receiverId}/${Date.now()}-${Math.random()
        .toString(36)
        .slice(2)}.${fileExt}`;

      const { error: uploadError } = await supabase.storage
        .from("message-images")
        .upload(filePath, imageFile);

      if (uploadError) {
        setLoading(false);
        showToast("Image upload failed: " + uploadError.message);
        return;
      }

      const { data: publicUrlData } = supabase.storage
        .from("message-images")
        .getPublicUrl(filePath);

      imageUrl = publicUrlData.publicUrl;
    }

    const {
      data: { session },
    } = await supabase.auth.getSession();

    let senderUsername: string | null = null;
    if (session?.user.id) {
      const { data: senderProfile } = await supabase
        .from("profiles")
        .select("username")
        .eq("id", session.user.id)
        .maybeSingle();
      senderUsername = senderProfile?.username || null;
    }

    const { error } = await supabase.from("messages").insert({
      recipient_id: receiverId,
      message: message.trim() ? message : null,
      image_url: imageUrl,
      sender_user_id: session?.user.id || null,
      sender_username: senderUsername,
      sender_email_name: sanitizeGmailName(session?.user.email),
    });

    setLoading(false);

    if (error) {
      showToast(error.message);
      return;
    }

    showToast("Message sent anonymously! 🎉");
    setMessage("");
    removeImage();
    setSent(true);
  }

  if (checkingProfile) {
    return (
      <main className="min-h-screen flex items-center justify-center theme-bg-gradient text-white">
        <p className="text-gray-400">Loading...</p>
      </main>
    );
  }

  if (!receiverId) {
    return (
      <main className="min-h-screen flex items-center justify-center theme-bg-gradient text-white text-center px-6">
        <div>
          <h1 className="page-title mb-2">User not found</h1>
          <p className="page-subtitle">@{username} doesn&apos;t exist on Whisper.</p>
        </div>
      </main>
    );
  }

  return (
    <main className="relative min-h-screen flex items-center justify-center theme-bg-gradient text-white px-4 overflow-hidden">

      {/* ── BACKGROUND GLOW ORBS ── */}
      <div className="pointer-events-none absolute -top-32 -left-32 h-[500px] w-[500px] rounded-full bg-purple-600/25 blur-[120px]" />
      <div className="pointer-events-none absolute -bottom-32 -right-32 h-[500px] w-[500px] rounded-full bg-cyan-500/20 blur-[120px]" />
      <div className="pointer-events-none absolute top-1/2 left-1/2 h-72 w-72 -translate-x-1/2 -translate-y-1/2 rounded-full bg-pink-500/10 blur-[100px]" />

      {/* ── DRIFTING REACTION EMOJI ──
          Behind the card, ahead of the orbs. Pure CSS keyframes rather than
          Framer: seven elements looping forever belong on the compositor, not
          in a JS animation loop that has to tick while someone is typing. */}
      <AmbientFloaters />

      {/* ── FLOATING WHISPER LOGO IN BACKGROUND ──
          `whisper-logo-float` is the glow plus a slow rise-and-tilt. Two
          separate animations on purpose: folding them into one keyframe set
          would force the 9s float to the glow's 3.5s period, and a logo
          bobbing that fast reads as a nervous tic rather than a drift. */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <Image
          src="/ghost.png"
          alt=""
          width={320}
          height={320}
          className="whisper-logo-float select-none"
          style={{
            filter: "grayscale(1) invert(1)",
          }}
          priority
          aria-hidden
        />
      </div>

      {/* ── GLASS CARD ── */}
      <motion.div
        className="relative z-10 w-full max-w-lg rounded-3xl p-8"
        variants={respectMotion(cardIn, reduced)}
        initial="hidden"
        animate="visible"
        style={{
          background:
            "linear-gradient(135deg, rgba(255,255,255,0.10) 0%, rgba(255,255,255,0.04) 100%)",
          backdropFilter: "blur(32px) saturate(180%)",
          WebkitBackdropFilter: "blur(32px) saturate(180%)",
          border: "1px solid rgba(255,255,255,0.12)",
          boxShadow:
            "0 8px 32px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.15)",
        }}
      >
        {/* ── INNER TOP SHINE ── */}
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-px rounded-t-3xl"
          style={{
            background:
              "linear-gradient(90deg, transparent, rgba(255,255,255,0.3), transparent)",
          }}
        />

        {/* ── PROFILE HEADER ── */}
        <motion.div
          className="flex items-center gap-4"
          variants={respectMotion(fadeUp, reduced)}
        >
          {avatarUrl ? (
            <img
              src={avatarUrl}
              alt={username}
              className="h-16 w-16 shrink-0 rounded-full object-cover"
              style={{
                border: "2px solid rgba(255,255,255,0.2)",
                boxShadow: "0 0 0 3px rgba(168,85,247,0.4)",
              }}
            />
          ) : (
            <div
              className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full"
              style={{
                background: "linear-gradient(135deg, #22d3ee, #a855f7)",
                boxShadow: "0 0 0 3px rgba(168,85,247,0.4)",
              }}
            >
              <User size={28} className="text-white" />
            </div>
          )}

          {/* min-w-0 so a long display name wraps instead of pushing the
              avatar out of the card. */}
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-bold leading-tight">
              {displayName || `@${username}`}
            </h1>
            {displayName && (
              <p className="mt-0.5 truncate text-sm" style={{ color: "#a78bfa" }}>
                @{username}
              </p>
            )}
          </div>
        </motion.div>

        {/* ── BIO ──
            Conditional on the outside, so someone without a bio gets no empty
            gap rather than a blank indent.

            `key={bio}` is what makes the live update read as a change: React
            remounts the paragraph when the text differs, replaying `initial`,
            so an edit made in /profile crossfades in here instead of silently
            swapping under the reader. */}
        {bio && (
          <motion.div className="mt-5" variants={respectMotion(fadeUp, reduced)}>
            <motion.p
              key={bio}
              initial={reduced ? false : { opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={tween.base}
              className="whitespace-pre-line break-words text-[0.9375rem] leading-relaxed text-white/75"
            >
              {bio}
            </motion.p>
          </motion.div>
        )}

        <motion.p
          className="mt-4 text-sm text-gray-300"
          variants={respectMotion(fadeUp, reduced)}
        >
          Send an anonymous message
        </motion.p>

        {sent ? (
          <motion.div
            className="mt-8 space-y-6"
            variants={respectMotion(fadeUp, reduced)}
          >
            <div
              className="rounded-2xl p-6 text-center"
              style={{
                background: "rgba(168,85,247,0.08)",
                border: "1px solid rgba(168,85,247,0.25)",
              }}
            >
              <p className="text-lg font-semibold">Sent! 🎉</p>
              <p className="text-gray-400 text-sm mt-1">
                Completely anonymous — they&apos;ll never know it was you.
              </p>
            </div>

            <div className="flex gap-3">
              <motion.button
                onClick={() => setSent(false)}
                whileTap={reduced ? undefined : { scale: 0.97 }}
                transition={spring.snappy}
                className="flex-1 rounded-2xl p-4 font-semibold text-white transition hover:bg-white/10"
                style={{
                  background: "rgba(255,255,255,0.07)",
                  border: "1px solid rgba(255,255,255,0.1)",
                }}
              >
                Send another
              </motion.button>
              <motion.button
                onClick={() =>
                  window.open("https://whisper-anonymous.vercel.app/signup")
                }
                whileTap={reduced ? undefined : { scale: 0.97 }}
                transition={spring.snappy}
                className="flex-1 rounded-2xl p-4 font-bold text-white transition hover:opacity-90"
                style={{
                  background: "linear-gradient(135deg, #22d3ee, #a855f7)",
                }}
              >
                Get your link
              </motion.button>
            </div>

            <p className="text-center text-xs text-gray-500">
              👻 Get your own Whisper link and start receiving anonymous messages too.
            </p>
          </motion.div>
        ) : (
          <motion.div
            className="space-y-4 mt-6"
            variants={respectMotion(fadeUp, reduced)}
          >
            {/* ── TEXTAREA ── */}
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Type your anonymous message..."
              className="h-32 w-full rounded-2xl p-4 outline-none resize-none text-white placeholder:text-gray-500 transition"
              style={{
                background: "rgba(0,0,0,0.25)",
                border: "1px solid rgba(255,255,255,0.08)",
                backdropFilter: "blur(8px)",
              }}
              onFocus={(e) => {
                e.currentTarget.style.border =
                  "1px solid rgba(168,85,247,0.5)";
              }}
              onBlur={(e) => {
                e.currentTarget.style.border =
                  "1px solid rgba(255,255,255,0.08)";
              }}
            />

            {/* ── IMAGE ATTACHMENT ── */}
            {imagePreview ? (
              <div className="relative">
                <img
                  src={imagePreview}
                  alt="Attached"
                  className="w-full max-h-64 rounded-2xl object-cover"
                />
                <button
                  type="button"
                  onClick={removeImage}
                  className="absolute top-2 right-2 rounded-full bg-black/70 p-1.5 hover:bg-black transition"
                >
                  <X size={16} />
                </button>
              </div>
            ) : (
              <label
                className="flex items-center justify-center gap-2 w-full rounded-2xl p-4 text-gray-400 cursor-pointer transition hover:text-purple-400"
                style={{ border: "1px dashed rgba(255,255,255,0.15)" }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.border =
                    "1px dashed rgba(168,85,247,0.5)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.border =
                    "1px dashed rgba(255,255,255,0.15)";
                }}
              >
                <ImagePlus size={20} />
                Attach an image (optional)
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleImageSelect}
                  className="hidden"
                />
              </label>
            )}

            {/* ── SEND BUTTON ── */}
            <motion.button
              type="button"
              onClick={sendMessage}
              disabled={loading}
              whileTap={reduced || loading ? undefined : { scale: 0.98 }}
              transition={spring.snappy}
              className="w-full rounded-2xl p-4 font-bold text-white transition hover:opacity-90 disabled:opacity-50"
              style={{
                background: "linear-gradient(135deg, #22d3ee 0%, #a855f7 100%)",
                boxShadow: "0 4px 24px rgba(168,85,247,0.35)",
              }}
            >
              {loading ? "Sending..." : "Send Message"}
            </motion.button>
          </motion.div>
        )}
      </motion.div>
    </main>
  );
}