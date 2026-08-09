"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { supabase } from "@/lib/supabase/client";
import { getCachedSession } from "@/lib/supabase/session";
import { presenceManager } from "@/lib/realtime/presence";

import DashboardHeader from "@/components/DashboardHeader";
import LinkCard from "@/components/LinkCard";
import StatsRow from "@/components/StatsRow";
import ActivityChart from "@/components/ActivityChart";
import RecentMessages from "@/components/RecentMessages";
import BottomNavigation from "@/components/BottomNavigation";
import BrandedLoader from "@/components/BrandedLoader";
import TermsModal from "@/components/TermsModal";

export default function DashboardPage() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [showTerms, setShowTerms] = useState(false);

  useEffect(() => {
    async function init() {
      const session = await getCachedSession();

      if (!session) {
        router.push("/login");
        return;
      }

      /* Not awaited, and deliberately never disconnected here.
       *
       * `presenceManager` is a process-wide singleton shared by the dashboard,
       * inbox, discover, friends, chat and the nav badge store. Tearing it down
       * in this component's cleanup meant that leaving the home tab — which is
       * on the path of most navigations — dropped the channel for all of them,
       * so the next page had to pay a full WebSocket subscribe and `track()`
       * before it could show a single online dot. It also raced the incoming
       * page's `connect()`, since unmount and mount effects interleave.
       *
       * Presence is session-scoped, not page-scoped. It connects once and stays
       * up; `disconnect()` belongs to sign-out. Not awaiting it here matters
       * too: the profile check below is what actually gates this screen, and it
       * has no reason to queue behind a handshake. */
      void presenceManager.connect(session.user.id);

      const { data: profile } = await supabase
        .from("profiles")
        .select("profile_completed")
        .eq("id", session.user.id)
        .single();

      if (!profile?.profile_completed) {
        router.push("/complete-profile");
        return;
      }

      const termsShownThisSession = sessionStorage.getItem("whisper-terms-shown") === "true";
      if (!termsShownThisSession) {
        sessionStorage.setItem("whisper-terms-shown", "true");
        setShowTerms(true);
      }

      setChecking(false);
    }

    init();
  }, [router]);
  if (checking) {
    return <BrandedLoader />;
  }

  return (
    <main className="relative min-h-screen overflow-hidden theme-bg-gradient pb-36">
      {/* Ambient drift.

          This used to be a 15s keyframe animating the `background` shorthand on
          <main> itself, which repaints a full-viewport gradient every frame on
          the main thread — the single most expensive thing on the screen. It's
          now two static gradient layers cross-fading on `opacity`, which the
          compositor handles without touching paint, and it looks identical. */}
      <div className="dashboard-ambient" aria-hidden />

      <div className="pointer-events-none absolute -top-40 -left-40 h-[500px] w-[500px] rounded-full bg-purple-600/10 blur-[180px]" />
      <div className="pointer-events-none absolute top-1/3 right-[-150px] h-[420px] w-[420px] rounded-full bg-purple-600/10 blur-[180px]" />

      <div className="relative mx-auto max-w-4xl space-y-5 p-6">
        <DashboardHeader />
        <LinkCard />
        <StatsRow />
        <ActivityChart />
        <RecentMessages />
      </div>

      <BottomNavigation />

      {showTerms && <TermsModal onAccept={() => setShowTerms(false)} />}
    </main>
  );
}