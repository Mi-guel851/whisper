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
    <main className="min-h-screen relative overflow-hidden">
      <Background />
      <Navbar />
      <Hero />
      <StatsStrip />
      <Features />
      <Testimonials />
      <HowItWorks />
      <ClosingCTA />
      <Footer />
    </main>
  );
}