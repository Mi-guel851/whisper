"use client";

import DashboardHeader from "@/components/DashboardHeader";
import ProfileCard from "@/components/ProfileCard";
import LinkCard from "@/components/LinkCard";
import AnalyticsCard from "@/components/AnalyticsCard";
import NotificationCard from "@/components/NotificationCard";
import RecentMessages from "@/components/RecentMessages";
import BottomNav from "@/components/BottomNav";

export default function DashboardPage() {
  return (
    <main className="min-h-screen bg-gradient-to-br from-[#090014] via-[#170033] to-[#02000A] pb-32">

      <div className="mx-auto max-w-3xl space-y-6 p-6">

        <DashboardHeader />

        <ProfileCard />

        <LinkCard />

        <AnalyticsCard />

        <NotificationCard />

        <RecentMessages />

      </div>

      <BottomNav />

    </main>
  );
}