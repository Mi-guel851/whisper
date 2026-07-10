"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { sanitizeGmailName } from "@/lib/coins";
import { useToast } from "@/components/ToastProvider";
import { ImagePlus, X, User } from "lucide-react";

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

  async function sendMessage(e: React.FormEvent) {
    e.preventDefault();
    if (!receiverId) return;

    if (!message.trim() && !imageFile) {
      showToast("Write a message or attach an image.");
      return;
    }

    setLoading(true);

    let imageUrl: string | null = null;

    if (imageFile) {
      const fileExt = imageFile.name.split(".").pop();
      const filePath = `${receiverId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${fileExt}`;

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

    const response = await fetch("/api/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
      },
      body: JSON.stringify({
        recipient_id: receiverId,
        message: message.trim() || null,
        image_url: imageUrl,
      }),
    });

    const result = await response.json().catch(() => null) as { error?: string } | null;
    const error = response.ok ? null : result?.error || "Message failed to send.";

    setLoading(false);

    if (error) {
      showToast(error);
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
    <main className="min-h-screen flex items-center justify-center theme-bg-gradient text-white px-4">
      <div className="w-full max-w-lg rounded-3xl bg-white/10 p-8 backdrop-blur-xl">

        <div className="flex items-center gap-4">
          {avatarUrl ? (
            <img
              src={avatarUrl}
              alt={username}
              className="h-16 w-16 rounded-full object-cover border-2 border-cyan-400"
            />
          ) : (
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-cyan-500 to-purple-600">
              <User size={28} className="text-white" />
            </div>
          )}

          <div>
            <h1 className="text-3xl font-bold leading-tight">
              {displayName || `@${username}`}
            </h1>
            {displayName && (
              <p className="text-cyan-300 text-sm">@{username}</p>
            )}
          </div>
        </div>

        <p className="mt-4 text-gray-300">
          Send an anonymous message
        </p>

        {sent ? (
          <div className="mt-8 space-y-6">
            <div className="rounded-2xl bg-cyan-500/10 border border-cyan-400/30 p-6 text-center">
              <p className="text-lg font-semibold">Sent! 🎉</p>
              <p className="text-gray-400 text-sm mt-1">
                Completely anonymous — they&apos;ll never know it was you.
              </p>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setSent(false)}
                className="flex-1 rounded-2xl bg-white/10 p-4 font-semibold text-white hover:bg-white/20 transition"
              >
                Send another
              </button>
             <button
  onClick={() => window.open("https://whisper-anonymous.vercel.app/signup")}
  className="flex-1 rounded-2xl bg-gradient-to-r from-purple-600 to-cyan-400 p-4 font-bold text-black hover:opacity-90 transition"
>
  Create your own link
</button>
            </div>

            <p className="text-center text-xs text-gray-500">
              👻 Get your own Whisper link and start receiving anonymous messages too.
            </p>
          </div>
        ) : (
          <form onSubmit={sendMessage} className="space-y-4 mt-6">
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Type your anonymous message..."
              className="h-32 w-full rounded-2xl bg-black/30 p-4 outline-none resize-none"
            />

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
              <label className="flex items-center justify-center gap-2 w-full rounded-2xl border border-dashed border-white/20 p-4 text-gray-400 hover:border-cyan-400 hover:text-cyan-300 cursor-pointer transition">
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

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-2xl bg-cyan-400 p-4 font-bold text-black disabled:opacity-60"
            >
              {loading ? "Sending..." : "Send Message"}
            </button>
          </form>
        )}

      </div>
    </main>
  );
}