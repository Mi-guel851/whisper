"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import Background from "../components/Background";
import Hero from "../components/Hero";
import Navbar from "../components/Navbar";
import LandingTopDownloadBanner from "../components/home/LandingTopDownloadBanner";
import StatsStrip from "../components/home/StatsStrip";
import Features from "../components/Features";
import Testimonials from "../components/home/Testimonials";
import HowItWorks from "../components/HowItWorks";
import ClosingCTA from "../components/ClosingCTA";
import Footer from "../components/Footer";
import BrandedLoader from "../components/BrandedLoader";

export default function Home() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        router.replace("/dashboard");
      } else {
        setChecking(false);
      }
    });
  }, [router]);

  if (checking) {
    return (
      <main>
        <BrandedLoader />
      </main>
    );
  }

  return (
    <main
      data-surface="dark"
      className="landing-dark-theme theme-bg-gradient min-h-screen relative overflow-x-hidden"
    >
      <Background />

      {/* Sticky hero block.
          
          `lg:` only. The hero column is a single stack below `lg` — navbar,
          eyebrow, heading, copy, two CTAs, the store lockup, social proof and
          the device mockup come to roughly 1330px against a 740px phone
          viewport. A `sticky top-0` box that is taller than the viewport pins
          its top and leaves the rest of itself permanently below the fold, so
          the mockup, the social proof and — because they scroll *behind* it —
          the download banner and every section under it were unreachable on a
          phone. From `lg` the hero is two columns and comfortably shorter than
          the viewport, which is the only width where pinning does what it was
          meant to do. */}
      <div
        className="relative z-20 overflow-hidden lg:sticky lg:top-0"
        style={{
          background: "color-mix(in srgb, var(--theme-bg) 92%, transparent)",
          backdropFilter: "blur(12px)",
          WebkitBackdropFilter: "blur(12px)",
        }}
      >
        <Navbar />
        <Hero />
        {/* Blur feather at the bottom edge — frosts content scrolling under.
            Only meaningful while the block above is pinned, so it is `lg:` too:
            unpinned it would sit over the download banner and blur it. */}
        <div
          className="hidden lg:block"
          style={{
            position: "absolute",
            bottom: "-40px",
            left: 0,
            right: 0,
            height: "80px",
            backdropFilter: "blur(80px) saturate(180%)",
            WebkitBackdropFilter: "blur(80px) saturate(180%)",
            maskImage: "linear-gradient(to bottom, black 0%, transparent 100%)",
            WebkitMaskImage: "linear-gradient(to bottom, black 0%, transparent 100%)",
            pointerEvents: "none",
            zIndex: 30,
          }}
        />
      </div>

      {/* Top Android download banner — prominent at top of scrollable landing, before stats */}
      <LandingTopDownloadBanner />

      {/* Scrollable content */}
      <div className="relative z-10">
        <StatsStrip />
        <Features />
        <Testimonials />
        <HowItWorks />
        <ClosingCTA />
        <Footer />
      </div>
    </main>
  );
}
