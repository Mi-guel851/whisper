"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";

import BackButton from "@/components/BackButton";
import BottomNavigation from "@/components/BottomNavigation";
import AvatarUpload from "@/components/AvatarUpload";
import { useToast } from "@/components/ToastProvider";
import LogoutButton from "@/components/LogoutButton";
export default function ProfilePage() {
  const router = useRouter();
  const { showToast } = useToast();

  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("");
  const [bio, setBio] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    async function loadProfile() {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        router.push("/login");
        return;
      }

      const { data } = await supabase
        .from("profiles")
        .select("display_name, username, bio")
        .eq("id", session.user.id)
        .single();

      if (data) {
        setDisplayName(data.display_name || "");
        setUsername(data.username || "");
        setBio(data.bio || "");
      }
    }
    loadProfile();
  }, [router]);

  async function saveProfile() {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) return;

    setLoading(true);
    const { error } = await supabase
      .from("profiles")
      .update({ display_name: displayName, username, bio })
      .eq("id", session.user.id);
    setLoading(false);

    if (error) {
      showToast(error.message);
      return;
    }
    showToast("Profile updated successfully 👤");
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-[#090014] via-[#170033] to-[#02000A] text-white p-6">
      <BackButton />

      <div className="mx-auto max-w-xl rounded-3xl bg-white/10 backdrop-blur-xl p-8">
        <h1 className="text-4xl font-bold mb-8">👤 Profile</h1>

        <div className="mb-6">
          <AvatarUpload />
        </div>

        <input
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="Display Name"
          className="mb-4 w-full rounded-2xl bg-black/30 p-4 outline-none"
        />
        <input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="Username"
          className="mb-4 w-full rounded-2xl bg-black/30 p-4 outline-none"
        />
        <textarea
          value={bio}
          onChange={(e) => setBio(e.target.value)}
          placeholder="Bio"
          rows={4}
          className="mb-6 w-full rounded-2xl bg-black/30 p-4 outline-none"
        />

        <button
          onClick={saveProfile}
          disabled={loading}
          className="w-full rounded-2xl bg-cyan-400 p-4 font-bold text-black"
        >
          {loading ? "Saving..." : "Save Profile"}
        </button>
        <div className="mt-6">
  <LogoutButton />
</div>
      </div>
      <BottomNavigation />
    </main>
  );
}<div className="mt-8">
  <LogoutButton />
</div>