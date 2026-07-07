"use client";

import { useRouter } from "next/navigation";
import { ChevronLeft, Check } from "lucide-react";
import GlassPanel from "@/components/GlassPanel";
import BottomNavigation from "@/components/BottomNavigation";
import { useTheme } from "@/components/ThemeProvider";
import { themeList } from "@/lib/themes";

export default function AppearancePage() {
  const router = useRouter();
  const { themeId, setThemeId } = useTheme();

  return (
    <main className="min-h-screen theme-bg-gradient text-white pb-28">
      <div className="mx-auto max-w-xl p-6">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.back()}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-white/5 transition hover:bg-white/10"
          >
            <ChevronLeft size={18} />
          </button>
          <span className="text-sm font-black tracking-wide">APPEARANCE</span>
        </div>

        <p className="mb-4 mt-6 text-xs font-bold uppercase tracking-widest text-gray-500">
          Choose a theme
        </p>

        <div className="space-y-3">
          {themeList.map((t) => {
            const active = t.id === themeId;
            return (
              <GlassPanel
                key={t.id}
                className={`flex cursor-pointer items-center gap-4 rounded-2xl p-4 transition ${
                  active ? "ring-2 ring-white/40" : ""
                }`}
                onClick={() => setThemeId(t.id)}
              >
                <div className="flex h-12 w-12 shrink-0 overflow-hidden rounded-xl">
                  {t.swatch.map((c, i) => (
                    <div key={i} className="h-full w-1/3" style={{ background: c }} />
                  ))}
                </div>
                <div className="flex-1">
                  <p className="font-semibold text-white">{t.name}</p>
                </div>
                {active && (
                  <div
                    className="flex h-6 w-6 items-center justify-center rounded-full"
                    style={{ background: t.accentFrom }}
                  >
                    <Check size={14} className="text-black" />
                  </div>
                )}
              </GlassPanel>
            );
          })}
        </div>
      </div>
      <BottomNavigation />
    </main>
  );
}