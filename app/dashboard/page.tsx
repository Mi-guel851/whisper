"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { supabase } from "@/lib/supabase/client";
import { presenceManager } from "@/lib/realtime/presence";

import DashboardHeader from "@/components/DashboardHeader";
import ProfileCard from "@/components/ProfileCard";
import LinkCard from "@/components/LinkCard";
import AnalyticsCard from "@/components/AnalyticsCard";
import NotificationCard from "@/components/NotificationCard";
import ActivityChart from "@/components/ActivityChart";
import RecentMessages from "@/components/RecentMessages";
import BottomNavigation from "@/components/BottomNavigation";

export default function DashboardPage() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let stopPresence: (() => void) | undefined;

    async function init() {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        router.push("/login");
        return;
      }

      await presenceManager.connect(session.user.id);

stopPresence = () => {
  presenceManager.disconnect();
};
      const { data: profile } = await supabase
        .from("profiles")
        .select("profile_completed")
        .eq("id", session.user.id)
        .single();

      if (!profile?.profile_completed) {
        router.push("/complete-profile");
        return;
      }

      setChecking(false);
    }

    init();

    return () => {
      stopPresence?.();
    };
  }, [router]);

  if (checking) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-[#05010F] text-white">
        <p className="text-gray-400">Loading...</p>
      </main>
    );
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-gradient-to-br from-[#05010F] via-[#120022] to-[#030008] pb-36">

      <div className="pointer-events-none absolute -top-40 -left-40 h-[500px] w-[500px] rounded-full bg-cyan-500/10 blur-[180px]" />

      <div className="pointer-events-none absolute top-1/3 right-[-150px] h-[420px] w-[420px] rounded-full bg-purple-600/10 blur-[180px]" />

      <div className="relative mx-auto max-w-4xl space-y-6 p-6">

        <DashboardHeader />

        <LinkCard />

        <ProfileCard />

        <div className="grid gap-6 md:grid-cols-2">
          <AnalyticsCard />
          <NotificationCard />
        </div>

        <ActivityChart />

        <RecentMessages />

      </div>

      <BottomNavigation />

    </main>
  );
}