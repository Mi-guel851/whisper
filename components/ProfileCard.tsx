// ProfileCard.tsx
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { User, Pencil, Camera } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import SectionLoadingBar from "./SectionLoadingBar";
import GlassPanel from "./GlassPanel";

type Profile = {
  display_name: string | null;
  username: string;
  bio: string | null;
  avatar_url: string | null;
};

export default function ProfileCard() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadProfile() {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        setLoading(false);
        return;
      }

      const { data } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", session.user.id)
        .single();

      if (data) {
        setProfile(data);
      }
      setLoading(false);
    }

    loadProfile();
  }, []);

  return (
    <GlassPanel className="rounded-3xl p-6">
      <SectionLoadingBar loading={loading} />

      {!loading && profile && (
        <>
          <div className="flex items-center gap-5">

            <div className="relative">

              {profile.avatar_url ? (
                <img
                  src={profile.avatar_url}
                  alt="Avatar"
                  className="h-24 w-24 rounded-full object-cover border-4 border-cyan-400"
                />
              ) : (
                <div className="flex h-24 w-24 items-center justify-center rounded-full bg-gradient-to-br from-cyan-500 to-purple-600">
                  <User size={40} className="text-white" />
                </div>
              )}

              <div className="absolute bottom-0 right-0 rounded-full bg-cyan-400 p-2">
                <Camera size={16} className="text-black" />
              </div>

            </div>

            <div className="flex-1">

              <h2 className="text-3xl font-bold text-white">
                {profile.display_name || "New User"}
              </h2>

              <p className="text-cyan-300">
                @{profile.username}
              </p>

              <p className="mt-2 text-gray-400">
                {profile.bio || "No bio yet."}
              </p>

            </div>

          </div>

          <Link
            href="/profile"
            className="mt-6 flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-purple-600 to-cyan-500 p-4 font-bold text-white transition hover:scale-105"
          >
            <Pencil size={18} />
            Edit Profile
          </Link>
        </>
      )}

    </GlassPanel>
  );
}