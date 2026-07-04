// app/admin/page.tsx
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import GlassPanel from "@/components/GlassPanel";
import BackButton from "@/components/BackButton";
import { Users, MessageCircle, Eye, ShieldAlert } from "lucide-react";

type Stats = {
  total_users: number;
  total_messages: number;
  total_views: number;
};

type SignupRow = {
  username: string;
  created_at: string;
};

export default function AdminPage() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [authorized, setAuthorized] = useState(false);
  const [stats, setStats] = useState<Stats | null>(null);
  const [recentSignups, setRecentSignups] = useState<SignupRow[]>([]);

  useEffect(() => {
    async function init() {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        router.push("/login");
        return;
      }

      const { data: profile } = await supabase
        .from("profiles")
        .select("is_admin")
        .eq("id", session.user.id)
        .single();

      if (!profile?.is_admin) {
        router.push("/dashboard");
        return;
      }

      setAuthorized(true);

      const { data: statsData, error: statsError } = await supabase.rpc("admin_stats");

      if (!statsError) {
        setStats(statsData as Stats);
      }

      const { data: signups } = await supabase
        .from("profiles")
        .select("username, created_at")
        .order("created_at", { ascending: false })
        .limit(10);

      setRecentSignups(signups || []);
      setChecking(false);
    }

    init();
  }, [router]);

  if (checking) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-[#05010F] text-white">
        <p className="text-gray-400">Loading...</p>
      </main>
    );
  }

  if (!authorized) return null;

  return (
    <main className="min-h-screen bg-gradient-to-br from-[#05010F] via-[#120022] to-[#030008] p-6 text-white">
      <BackButton />

      <div className="mx-auto max-w-4xl mt-4">
        <div className="mb-8 flex items-center gap-3">
          <ShieldAlert className="text-cyan-400" size={32} />
          <h1 className="text-4xl font-black">Admin Dashboard</h1>
        </div>

        <div className="grid gap-6 md:grid-cols-3 mb-8">
          <GlassPanel className="rounded-3xl p-6">
            <Users className="text-cyan-300 mb-3" size={24} />
            <div className="text-3xl font-black">{stats?.total_users ?? "—"}</div>
            <div className="text-gray-400 mt-1">Total Users</div>
          </GlassPanel>

          <GlassPanel className="rounded-3xl p-6">
            <MessageCircle className="text-purple-300 mb-3" size={24} />
            <div className="text-3xl font-black">{stats?.total_messages ?? "—"}</div>
            <div className="text-gray-400 mt-1">Total Messages</div>
          </GlassPanel>

          <GlassPanel className="rounded-3xl p-6">
            <Eye className="text-pink-300 mb-3" size={24} />
            <div className="text-3xl font-black">{stats?.total_views ?? "—"}</div>
            <div className="text-gray-400 mt-1">Total Link Views</div>
          </GlassPanel>
        </div>

        <GlassPanel className="rounded-3xl p-6">
          <h2 className="mb-4 text-2xl font-bold">Recent Signups</h2>

          {recentSignups.length === 0 ? (
            <p className="text-gray-400">No signups yet.</p>
          ) : (
            <div className="space-y-2">
              {recentSignups.map((u, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between rounded-xl bg-white/5 px-4 py-3"
                >
                  <span className="font-semibold text-cyan-300">@{u.username}</span>
                  <span className="text-sm text-gray-500">
                    {new Date(u.created_at).toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </GlassPanel>
      </div>
    </main>
  );
}