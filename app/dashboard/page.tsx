"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import ActivityChart from "@/components/ActivityChart";
import DashboardHeader from "@/components/DashboardHeader";
import ProfileCard from "@/components/ProfileCard";
import LinkCard from "@/components/LinkCard";
import AnalyticsCard from "@/components/AnalyticsCard";
import NotificationCard from "@/components/NotificationCard";
import RecentMessages from "@/components/RecentMessages";
import BottomNavigation from "@/components/BottomNavigation";

export default function DashboardPage() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    async function check() {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        router.push("/login");
        return;
      }

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

    check();
  }, [router]);

  if (checking) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-[#090014] text-white">
        <p className="text-gray-400">Loading...</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-[#05010F] via-[#120022] to-[#030008] pb-36">

      <div className="mx-auto max-w-4xl space-y-6 p-6">

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