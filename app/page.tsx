"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import Background from "../components/Background";
import Hero from "../components/Hero";
import Navbar from "../components/Navbar";
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
    <main className="min-h-screen relative overflow-x-hidden" style={{ background: "#0a0814" }}>
      <Background />

      {/* Sticky hero block */}
      <div
        className="sticky top-0 z-20 overflow-hidden"
        style={{
          background: "rgba(10, 8, 20, 0.92)",
          backdropFilter: "blur(12px)",
          WebkitBackdropFilter: "blur(12px)",
        }}
      >
        <Navbar />
        <Hero />
        {/* Blur feather at the bottom edge — frosts content scrolling under */}
        <div
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