"use client";

import Link from "next/link";
import { useTheme } from "@/components/ThemeProvider";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { ChevronLeft, User, AtSign, Sparkles, Save, ShieldCheck, Palette, ChevronRight } from "lucide-react";
import { supabase } from "@/lib/supabase/client";

import BottomNavigation from "@/components/BottomNavigation";
import AvatarUpload from "@/components/AvatarUpload";
import { useToast } from "@/components/ToastProvider";
import LogoutButton from "@/components/LogoutButton";
import GlassPanel from "@/components/GlassPanel";

const BIO_LIMIT = 140;

export default function ProfilePage() {
  const router = useRouter();
  const { showToast } = useToast();
  const { theme } = useTheme();

  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("");
  const [bio, setBio] = useState("");
  const [loading, setLoading] = useState(false);
  const [initialLoad, setInitialLoad] = useState(true);

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
      setInitialLoad(false);
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
    <main className="min-h-screen theme-bg-gradient text-white pb-28">
      <div className="mx-auto max-w-xl p-6">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.back()}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-white/5 transition hover:bg-white/10"
          >
            <ChevronLeft size={18} />
          </button>
          <div className="flex items-center gap-2">
            <Image src="/ghost.png" alt="Whisper" width={24} height={24} />
            <span className="text-sm font-black tracking-wide">WHISPER</span>
          </div>
        </div>

        <GlassPanel className="mt-6 rounded-3xl p-8 text-center">
          <div className="flex justify-center">
            <AvatarUpload />
          </div>

          <h1 className="mt-4 text-2xl font-bold text-white">
            {displayName || "New User"}
          </h1>
          <p className="text-purple-300">@{username || "username"}</p>
          <p className="mt-2 text-sm text-gray-300">
            {bio || "Just here for the honest whispers ✨"}
          </p>
        </GlassPanel>

        <div className="mt-4 space-y-4">
          <GlassPanel className="rounded-2xl p-4">
            <label className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-widest text-gray-300">
              <User size={12} />
              Display Name
            </label>
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Your name"
              className="mt-2 w-full bg-transparent text-lg font-semibold text-white outline-none placeholder:text-gray-500"
            />
          </GlassPanel>

          <GlassPanel className="rounded-2xl p-4">
            <label className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-widest text-gray-300">
              <AtSign size={12} />
              Username
            </label>
            <div className="mt-2 flex items-center text-lg">
              <span className="text-gray-400">whisper.app/u/</span>
              <input
                value={username}
                onChange={(e) =>
                  setUsername(e.target.value.replace(/\s+/g, "").toLowerCase())
                }
                placeholder="username"
                className="flex-1 bg-transparent font-semibold text-white outline-none placeholder:text-gray-500"
              />
            </div>
          </GlassPanel>

          <GlassPanel className="rounded-2xl p-4">
            <label className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-widest text-gray-300">
              <Sparkles size={12} />
              Bio
            </label>
            <textarea
              value={bio}
              onChange={(e) => setBio(e.target.value.slice(0, BIO_LIMIT))}
              placeholder="Tell people a little about yourself..."
              rows={3}
              className="mt-2 w-full resize-none bg-transparent text-white outline-none placeholder:text-gray-500"
            />
            <div className="text-right text-xs text-gray-400">
              {bio.length}/{BIO_LIMIT}
            </div>
          </GlassPanel>

          <button
            onClick={saveProfile}
            disabled={loading || initialLoad}
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-purple-500 to-cyan-400 py-4 font-bold text-black transition hover:scale-[1.01] disabled:opacity-60"
          >
            <Save size={18} />
            {loading ? "Saving..." : "Save changes"}
          </button>
        </div>

        <div className="mt-8">
          <p className="mb-3 text-xs font-bold uppercase tracking-widest text-gray-300">
            Account
          </p>

          <GlassPanel className="divide-y divide-white/5 rounded-2xl">
            <Link href="/privacy" className="flex items-center gap-4 p-4">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-purple-500/15 text-purple-300">
                <ShieldCheck size={18} />
              </div>
              <div className="flex-1">
                <p className="font-semibold text-white">Privacy & safety</p>
                <p className="text-xs text-gray-400">Fully protected</p>
              </div>
              <ChevronRight size={16} className="text-gray-400" />
            </Link>

            <Link href="/appearance" className="flex items-center gap-4 p-4">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-purple-500/15 text-purple-300">
                <Palette size={18} />
              </div>
              <div className="flex-1">
                <p className="font-semibold text-white">Appearance</p>
                <p className="text-xs text-gray-400">{theme.name}</p>
              </div>
              <ChevronRight size={16} className="text-gray-400" />
            </Link>
          </GlassPanel>
        </div>

        <div className="mt-6">
          <LogoutButton />
        </div>
      </div>

      <BottomNavigation />
    </main>
  );
}