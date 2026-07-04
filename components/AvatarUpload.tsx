"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { useToast } from "@/components/ToastProvider";
import { Camera, User } from "lucide-react";

export default function AvatarUpload() {
  const { showToast } = useToast();
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

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
  }, []);

  async function upload(e: React.ChangeEvent<HTMLInputElement>) {
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

    // instant local preview while it uploads
    const localPreview = URL.createObjectURL(file);
    setAvatarUrl(localPreview);
    setLoading(true);

    const fileName = `${Date.now()}-${file.name}`;

    const { error: uploadError } = await supabase.storage
      .from("avatars")
      .upload(fileName, file);

    if (uploadError) {
      setLoading(false);
      showToast(uploadError.message);
      return;
    }

    const { data: publicUrlData } = supabase.storage
      .from("avatars")
      .getPublicUrl(fileName);

    const url = publicUrlData.publicUrl;

    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session) {
      setLoading(false);
      return;
    }

    const { error: updateError } = await supabase
      .from("profiles")
      .update({ avatar_url: url })
      .eq("id", session.user.id);

    setLoading(false);

    if (updateError) {
      showToast(updateError.message);
      return;
    }

    setAvatarUrl(url);
    showToast("Profile picture updated 👻");
  }

  return (
    <div className="flex flex-col items-center gap-4 rounded-2xl border border-white/10 bg-white/5 p-6">

      <div className="relative">
        {avatarUrl ? (
          <img
            src={avatarUrl}
            alt="Profile"
            className="h-28 w-28 rounded-full object-cover border-4 border-cyan-400"
          />
        ) : (
          <div className="flex h-28 w-28 items-center justify-center rounded-full bg-gradient-to-br from-cyan-500 to-purple-600">
            <User size={44} className="text-white" />
          </div>
        )}

        <label
          htmlFor="avatar-input"
          className="absolute bottom-0 right-0 flex h-9 w-9 cursor-pointer items-center justify-center rounded-full bg-cyan-400 hover:bg-cyan-300 transition"
        >
          <Camera size={18} className="text-black" />
        </label>

        <input
          id="avatar-input"
          type="file"
          accept="image/*"
          onChange={upload}
          className="hidden"
        />
      </div>

      {loading && <p className="text-sm text-cyan-400">Uploading...</p>}

    </div>
  );
}