"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { supabase } from "@/lib/supabase/client";
import { presenceManager } from "@/lib/realtime/presence";

import DashboardHeader from "@/components/DashboardHeader";
import LinkCard from "@/components/LinkCard";
import StatsRow from "@/components/StatsRow";
import ActivityChart from "@/components/ActivityChart";
import RecentMessages from "@/components/RecentMessages";
import BottomNavigation from "@/components/BottomNavigation";
import TermsModal from "@/components/TermsModal";

export default function DashboardPage() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [showTerms, setShowTerms] = useState(false);

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

      const termsShownThisSession = sessionStorage.getItem("whisper-terms-shown") === "true";
      if (!termsShownThisSession) {
        sessionStorage.setItem("whisper-terms-shown", "true");
        setShowTerms(true);
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
    <main className="relative min-h-screen overflow-hidden theme-bg-gradient pb-36">
      <style>{`
        @keyframes bgColorShift {
          0%, 100% {
            background: radial-gradient(circle at top left, var(--theme-accent-purple), transparent 34rem),
                        radial-gradient(circle at bottom right, var(--theme-accent-pink), transparent 32rem),
                        linear-gradient(180deg, var(--theme-bg), var(--theme-surface));
          }
          50% {
            background: radial-gradient(circle at top right, var(--theme-accent-pink), transparent 34rem),
                        radial-gradient(circle at bottom left, var(--theme-accent-purple), transparent 32rem),
                        linear-gradient(180deg, var(--theme-surface), var(--theme-bg));
          }
        }
        main.theme-bg-gradient {
          animation: bgColorShift 15s ease-in-out infinite;
        }
      `}</style>
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