"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { sanitizeGmailName } from "@/lib/coins";
import { useToast } from "@/components/ToastProvider";
import { ImagePlus, X, User } from "lucide-react";
import Image from "next/image";

export default function PublicProfile() {
  const params = useParams();
  const username = params.username as string;
  const { showToast } = useToast();

  const [receiverId, setReceiverId] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [checkingProfile, setCheckingProfile] = useState(true);
  const [message, setMessage] = useState("");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    async function loadProfile() {
      const { data } = await supabase
        .from("profiles")
        .select("id, username, avatar_url, display_name")
        .eq("username", username)
        .single();

      if (data) {
        setReceiverId(data.id);
        setAvatarUrl(data.avatar_url);
        setDisplayName(data.display_name);
        await supabase.from("profile_views").insert({ profile_id: data.id });
      }
      setCheckingProfile(false);
    }

    loadProfile();
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
          <h1 className="text-3xl font-bold mb-2">User not found</h1>
          <p className="text-gray-400">@{username} doesn&apos;t exist on Whisper.</p>
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

      {/* ── GLOWING WHISPER LOGO IN BACKGROUND ── */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <Image
          src="/ghost.png"
          alt=""
          width={320}
          height={320}
          className="whisper-logo-glow select-none"
          style={{
            filter: "grayscale(1) invert(1)",
          }}
          aria-hidden
        />
      </div>

      {/* ── GLASS CARD ── */}
      <div
        className="relative z-10 w-full max-w-lg rounded-3xl p-8"
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
        <div className="flex items-center gap-4">
          {avatarUrl ? (
            <img
              src={avatarUrl}
              alt={username}
              className="h-16 w-16 rounded-full object-cover"
              style={{
                border: "2px solid rgba(255,255,255,0.2)",
                boxShadow: "0 0 0 3px rgba(168,85,247,0.4)",
              }}
            />
          ) : (
            <div
              className="flex h-16 w-16 items-center justify-center rounded-full"
              style={{
                background: "linear-gradient(135deg, #22d3ee, #a855f7)",
                boxShadow: "0 0 0 3px rgba(168,85,247,0.4)",
              }}
            >
              <User size={28} className="text-white" />
            </div>
          )}

          <div>
            <h1 className="text-2xl font-bold leading-tight">
              {displayName || `@${username}`}
            </h1>
            {displayName && (
              <p className="text-sm mt-0.5" style={{ color: "#a78bfa" }}>
                @{username}
              </p>
            )}
          </div>
        </div>

        <p className="mt-4 text-sm text-gray-300">Send an anonymous message</p>

        {sent ? (
          <div className="mt-8 space-y-6">
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
              <button
                onClick={() => setSent(false)}
                className="flex-1 rounded-2xl p-4 font-semibold text-white transition hover:bg-white/10"
                style={{
                  background: "rgba(255,255,255,0.07)",
                  border: "1px solid rgba(255,255,255,0.1)",
                }}
              >
                Send another
              </button>
              <button
                onClick={() =>
                  window.open("https://whisper-anonymous.vercel.app/signup")
                }
                className="flex-1 rounded-2xl p-4 font-bold text-white transition hover:opacity-90"
                style={{
                  background: "linear-gradient(135deg, #22d3ee, #a855f7)",
                }}
              >
                Get your link
              </button>
            </div>

            <p className="text-center text-xs text-gray-500">
              👻 Get your own Whisper link and start receiving anonymous messages too.
            </p>
          </div>
        ) : (
          <div className="space-y-4 mt-6">
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
            <button
              type="button"
              onClick={sendMessage}
              disabled={loading}
              className="w-full rounded-2xl p-4 font-bold text-white transition hover:opacity-90 disabled:opacity-50"
              style={{
                background: "linear-gradient(135deg, #22d3ee 0%, #a855f7 100%)",
                boxShadow: "0 4px 24px rgba(168,85,247,0.35)",
              }}
            >
              {loading ? "Sending..." : "Send Message"}
            </button>
          </div>
        )}
      </div>
    </main>
  );
}