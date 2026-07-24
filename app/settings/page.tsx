"use client";

import Link from "next/link";
import { Palette, ChevronRight, Settings } from "lucide-react";
import BottomNavigation from "@/components/BottomNavigation";
import GlassPanel from "@/components/GlassPanel";
import { useTheme } from "@/components/ThemeProvider";

export default function SettingsPage() {
  const { theme } = useTheme();

  return (
    <main className="min-h-screen theme-bg-gradient pb-28">
      <div className="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6">
        <div className="flex items-center gap-3">
          <Settings style={{ color: "var(--theme-accent)" }} />
          <h1 className="text-4xl font-black" style={{ color: "var(--theme-text-primary)" }}>Settings</h1>
        </div>

        <section className="mt-8">
          <p className="mb-3 text-xs font-bold uppercase tracking-widest" style={{ color: "var(--theme-text-subtle)" }}>Appearance</p>
          <Link href="/appearance">
            <GlassPanel className="flex items-center gap-4 rounded-3xl p-4 transition hover:scale-[1.01]">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl" style={{ background: "var(--theme-accent-soft)", color: "var(--theme-accent)" }}>
                <Palette size={20} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-black" style={{ color: "var(--theme-text-primary)" }}>Theme</p>
                <p className="truncate text-sm" style={{ color: "var(--theme-text-secondary)" }}>{theme.name} · {theme.accent.name}</p>
              </div>
              <ChevronRight size={18} style={{ color: "var(--theme-text-subtle)" }} />
            </GlassPanel>
          </Link>
        </section>
      </div>
      <BottomNavigation />
    </main>
  );
}
