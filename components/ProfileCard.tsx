"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase/client";

export default function ProfileCard() {
  const [profile, setProfile] = useState<any>(null);

  useEffect(() => {
    async function loadProfile() {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) return;

      const { data } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", session.user.id)
        .single();

      setProfile(data);
    }

    loadProfile();
  }, []);

  if (!profile) return null;

  const profileLink = `${window.location.origin}/u/${profile.username}`;

  async function copyLink() {
    await navigator.clipboard.writeText(profileLink);
    alert("Anonymous link copied!");
  }

  return (
    <div className="rounded-3xl bg-white/10 border border-white/10 backdrop-blur-xl p-6">

      <div className="flex items-center gap-4">

        <div className="h-20 w-20 rounded-full bg-gradient-to-r from-purple-500 to-cyan-500 flex items-center justify-center text-3xl font-bold">
          {profile.display_name?.charAt(0).toUpperCase()}
        </div>

        <div>
          <h2 className="text-2xl font-bold text-white">
            {profile.display_name}
          </h2>

          <p className="text-cyan-400">
            @{profile.username}
          </p>

          <p className="mt-2 text-gray-400">
            {profile.bio || "No bio yet"}
          </p>
        </div>

      </div>

      <div className="mt-6 grid grid-cols-2 gap-3">

        <button
          onClick={copyLink}
          className="rounded-2xl bg-cyan-400 p-3 font-bold text-black"
        >
          📋 Copy Link
        </button>

        <Link
          href="/profile"
          className="rounded-2xl bg-purple-600 p-3 text-center font-bold"
        >
          ✏ Edit
        </Link>

      </div>

    </div>
  );
}