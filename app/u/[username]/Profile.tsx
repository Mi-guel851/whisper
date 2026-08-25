"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { sanitizeGmailName } from "@/lib/coins";
import { useToast } from "@/components/ToastProvider";
import {
  CLOUDINARY_FOLDERS,
  CloudinaryUploadError,
  uploadToCloudinary,
} from "@/lib/cloudinary";
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

    if (file.size > 5 * 1024 * 1024) {
      showToast("Image must be under 5MB.");
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
      /* Folder is the recipient's id — the same ownership rule as ClientPage. */
      try {
        const uploaded = await uploadToCloudinary(
          imageFile,
          `${CLOUDINARY_FOLDERS.messageImages}/${receiverId}`
        );
        imageUrl = uploaded.url;
      } catch (error) {
        setLoading(false);
        showToast(
          error instanceof CloudinaryUploadError
            ? `Image upload failed: ${error.message}`
            : "Image upload failed."
        );
        return;
      }
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

    // Detect device and browser metadata
    let deviceName = "Unknown Device";
    let browserName = "Unknown Browser";
    if (typeof window !== "undefined") {
      const ua = window.navigator.userAgent;
      if (/android/i.test(ua)) deviceName = "Android phone";
      else if (/iPhone/i.test(ua)) deviceName = "iPhone";
      else if (/iPad/i.test(ua)) deviceName = "iPad";
      else if (/Macintosh/i.test(ua)) deviceName = "Mac computer";
      else if (/Windows/i.test(ua)) deviceName = "Windows PC";
      else if (/Linux/i.test(ua)) deviceName = "Linux device";

      if (/Edg\//i.test(ua)) browserName = "Edge";
      else if (/Chrome|CriOS/i.test(ua)) browserName = "Chrome";
      else if (/Firefox/i.test(ua)) browserName = "Firefox";
      else if (/Safari/i.test(ua)) browserName = "Safari";
      else if (/SamsungBrowser/i.test(ua)) browserName = "Samsung Internet";
    }

    const senderDeviceInfo = [deviceName, browserName].filter(Boolean).join(" • ");

    // Fetch approximate location metadata
    let locationData = { country: null, region: null, city: null };
    try {
      const locRes = await fetch("https://ipapi.co/json/");
      if (locRes.ok) {
        const json = await locRes.json();
        locationData = {
          country: json.country_name || null,
          region: json.region || null,
          city: json.city || null
        };
      }
    } catch (e) {
      console.error("Location fetch failed", e);
    }

    const { error } = await supabase.from("messages").insert({
      recipient_id: receiverId,
      message: message.trim() ? message : null,
      image_url: imageUrl,
      sender_user_id: session?.user.id || null,
      sender_username: senderUsername,
      sender_email_name: sanitizeGmailName(session?.user.email),
      sender_country: locationData.country,
      sender_state: locationData.region,
      sender_city: locationData.city,
      sender_device: senderDeviceInfo,
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
    <main className="min-h-screen flex items-center justify-center theme-bg-gradient text-white px-4">
      <div className="w-full max-w-lg rounded-3xl bg-white/10 p-8 backdrop-blur-xl">

        <div className="flex items-center gap-4">
          {avatarUrl ? (
            <img
              src={avatarUrl}
              alt={username}
              className="h-16 w-16 rounded-full object-cover border-2 border-purple-500"
            />
          ) : (
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-purple-600 to-purple-600">
              <User size={28} className="text-white" />
            </div>
          )}

          <div>
            <h1 className="page-title">
              {displayName || `@${username}`}
            </h1>
            {displayName && (
              <p className="text-purple-400 text-sm">@{username}</p>
            )}
          </div>
        </div>

        <p className="mt-4 text-gray-300">
          Send an anonymous message
        </p>

        {sent ? (
          <div className="mt-8 space-y-6">
            <div className="rounded-2xl bg-purple-600/10 border border-purple-500/30 p-6 text-center">
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
  className="flex-1 rounded-2xl bg-gradient-to-r from-purple-600 to-purple-500 p-4 font-bold text-black hover:opacity-90 transition"
>
  Create your own link
</button>
            </div>

            <p className="text-center text-xs text-gray-500">
              👻 Get your own Whisper link and start receiving anonymous messages too.
            </p>
          </div>
        ) : (
          <form onSubmit={(e) => e.preventDefault()} className="space-y-4 mt-6">
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
              <label className="flex items-center justify-center gap-2 w-full rounded-2xl border border-dashed border-white/20 p-4 text-gray-400 hover:border-purple-500 hover:text-purple-400 cursor-pointer transition">
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
              type="button"
              onClick={sendMessage}
              disabled={loading}
              className="w-full rounded-2xl bg-purple-500 p-4 font-bold text-black disabled:opacity-60"
            >
              {loading ? "Sending..." : "Send Message"}
            </button>
          </form>
        )}

      </div>
    </main>
  );
}