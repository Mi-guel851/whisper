"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase/client";

export default function EditProfileModal() {
  const [username, setUsername] = useState("");

  async function save() {
    const user = await supabase.auth.getUser();

    await supabase
      .from("profiles")
      .update({ username })
      .eq("id", user.data.user?.id);

    alert("Profile updated");
  }

  return (
    <div className="rounded-3xl bg-white/10 border border-white/10 p-6 backdrop-blur-xl">

      <h2 className="text-white font-bold text-xl mb-4">
        Edit Profile
      </h2>

      <input
        className="w-full p-3 rounded-xl bg-black/40 text-white"
        placeholder="Username"
        value={username}
        onChange={(e) => setUsername(e.target.value)}
      />

      <button
        onClick={save}
        className="mt-4 w-full bg-cyan-400 text-black font-bold p-3 rounded-xl"
      >
        Save
      </button>

    </div>
  );
}