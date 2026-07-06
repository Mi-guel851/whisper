"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import Background from "../components/Background";
import Hero from "../components/Hero";
import Navbar from "../components/Navbar";
import Features from "../components/Features";
import HowItWorks from "../components/HowItWorks";
import ClosingCTA from "../components/ClosingCTA";
import Footer from "../components/Footer";

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
      <main className="min-h-screen flex items-center justify-center bg-[#090014]">
        <p className="text-gray-400 text-sm">Loading...</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen relative overflow-hidden">
      <Background />
      <Navbar />
      <Hero />
      <Features />
      <HowItWorks />
      <ClosingCTA />
      <Footer />
    </main>
  );
}