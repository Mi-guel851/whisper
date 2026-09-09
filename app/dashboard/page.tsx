"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { supabase } from "@/lib/supabase/client";
import { getCachedSession } from "@/lib/supabase/session";
import { presenceManager } from "@/lib/realtime/presence";

import ActivityChart from "@/components/ActivityChart";
import BottomNavigation from "@/components/BottomNavigation";
import BrandedLoader from "@/components/BrandedLoader";
import DailyWhisperCard from "@/components/DailyWhisperCard";
import LinkCard from "@/components/LinkCard";
import LiveActivityStrip from "@/components/LiveActivityStrip";
import RecentMessages from "@/components/RecentMessages";
import TermsModal from "@/components/TermsModal";
import DashboardHero from "@/components/dashboard/DashboardHero";
import DashboardRightRail from "@/components/dashboard/DashboardRightRail";
import DashboardSidebar from "@/components/dashboard/DashboardSidebar";
import DashboardTopbar from "@/components/dashboard/DashboardTopbar";
import PublicFeedPreview from "@/components/dashboard/PublicFeedPreview";
import type { DashboardProfile } from "@/components/dashboard/types";
import { useDashboardFeed } from "@/components/dashboard/useDashboardFeed";

type ProfileRow = DashboardProfile & { profile_completed: boolean | null };

function DashboardExperience({ profile }: { profile: DashboardProfile }) {
  const feed = useDashboardFeed(profile.id);

  return (
    <main className="dashboard-shell theme-bg-gradient">
      <div className="dashboard-ambient" aria-hidden />
      <DashboardSidebar profile={profile} />
      <DashboardTopbar profile={profile} />

      <div className="dashboard-center-column">
        <DashboardHero profile={profile} />
        <LiveActivityStrip />

        <section id="whisper-link" className="dashboard-personal-grid" aria-label="Your sharing tools">
          <LinkCard username={profile.username} />
          <DailyWhisperCard initialUsername={profile.username} />
        </section>

        <PublicFeedPreview feed={feed} />

        <section id="engagement" className="dashboard-insights-grid" aria-label="Your recent activity">
          <ActivityChart initialUserId={profile.id} />
          <RecentMessages initialUserId={profile.id} />
        </section>
      </div>

      <DashboardRightRail
        userId={profile.id}
        topics={feed.topics}
        loadingTopics={feed.loading}
      />

      <div className="dashboard-bottom-nav"><BottomNavigation /></div>
    </main>
  );
}

export default function DashboardPage() {
  const router = useRouter();
  const [profile, setProfile] = useState<DashboardProfile | null>(null);
  const [checking, setChecking] = useState(true);
  const [showTerms, setShowTerms] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      const session = await getCachedSession();
      if (cancelled) return;

      if (!session) {
        router.replace("/login");
        return;
      }

      /* Presence is session-scoped and process-wide. Connecting here is
         idempotent; it must survive navigation so friends and nav badges do not
         pay another WebSocket handshake on every page. */
      void presenceManager.connect(session.user.id);

      const { data, error } = await supabase
        .from("profiles")
        .select("id,username,display_name,avatar_url,push_notifications,profile_completed")
        .eq("id", session.user.id)
        .single();

      if (cancelled) return;
      const row = data as ProfileRow | null;
      if (error || !row?.profile_completed || !row.username) {
        router.replace("/complete-profile");
        return;
      }

      const termsShownThisSession = sessionStorage.getItem("whisper-terms-shown") === "true";
      if (!termsShownThisSession) {
        sessionStorage.setItem("whisper-terms-shown", "true");
        setShowTerms(true);
      }

      setProfile({
        id: row.id,
        username: row.username,
        display_name: row.display_name,
        avatar_url: row.avatar_url,
        push_notifications: Boolean(row.push_notifications),
      });
      setChecking(false);
    }

    void init();
    return () => {
      cancelled = true;
    };
  }, [router]);

  if (checking || !profile) return <BrandedLoader />;

  return (
    <>
      <DashboardExperience profile={profile} />
      {showTerms && <TermsModal onAccept={() => setShowTerms(false)} />}
    </>
  );
}
