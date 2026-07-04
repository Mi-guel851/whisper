"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase/client";

export default function AvatarUpload() {
  const [loading, setLoading] = useState(false);

  async function upload(e: any) {
    const file = e.target.files[0];
    if (!file) return;

    setLoading(true);

    const fileName = `${Date.now()}-${file.name}`;

    const { error } = await supabase.storage
      .from("avatars")
      .upload(fileName, file);

    if (error) {
      alert(error.message);
      setLoading(false);
      return;
    }

    const { data } = supabase.storage
      .from("avatars")
      .getPublicUrl(fileName);

    const url = data.publicUrl;

    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session) return;

    await supabase
      .from("profiles")
      .update({ avatar_url: url })
      .eq("id", session.user.id);

    setLoading(false);
    alert("Profile image updated 👻");
  }

  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">

      <input type="file" accept="image/*" onChange={upload} />

      {loading && (
        <p className="mt-2 text-cyan-400">Uploading...</p>
      )}

    </div>
  );
}