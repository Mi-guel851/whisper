"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";

import BackButton from "@/components/BackButton";
import StatsRow from "@/components/StatsRow";
import ActivityChart from "@/components/ActivityChart";
import RecentMessages from "@/components/RecentMessages";
import BottomNavigation from "@/components/BottomNavigation";

export default function AnalyticsPage() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    async function checkAuth() {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        router.push("/login");
        return;
      }

      setChecking(false);
    }

    checkAuth();
  }, [router]);

  if (checking) {
    return (
      <main className="min-h-screen flex items-center justify-center theme-bg-gradient text-white">
        <p className="text-gray-400">Loading...</p>
      </main>
    );
  }

  return (
    <main className="relative min-h-screen overflow-hidden theme-bg-gradient pb-36">
      <div className="pointer-events-none absolute -top-40 -left-40 h-[500px] w-[500px] rounded-full bg-purple-600/10 blur-[180px]" />
      <div className="pointer-events-none absolute top-1/3 right-[-150px] h-[420px] w-[420px] rounded-full bg-purple-600/10 blur-[180px]" />

      <div className="relative mx-auto max-w-4xl space-y-5 p-6">
        <BackButton />
        
        <div className="mt-4">
          <h1 className="text-4xl font-black text-white mb-2">Analytics</h1>
          <p className="text-gray-400">Your activity and engagement overview</p>
        </div>

        <StatsRow />
        <ActivityChart />
        <RecentMessages />
      </div>

      <BottomNavigation />
    </main>
  );
}