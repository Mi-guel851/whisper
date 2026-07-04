"use client";
import ActivityChart from "@/components/ActivityChart";
import DashboardHeader from "@/components/DashboardHeader";
import ProfileCard from "@/components/ProfileCard";
import LinkCard from "@/components/LinkCard";
import AnalyticsCard from "@/components/AnalyticsCard";
import NotificationCard from "@/components/NotificationCard";
import RecentMessages from "@/components/RecentMessages";
import BottomNavigation from "@/components/BottomNavigation";

export default function DashboardPage() {
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

        <RecentMessages />

      </div>

      <BottomNavigation />

    </main>
  );
}