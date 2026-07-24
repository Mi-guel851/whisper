"use client";

import { useRouter } from "next/navigation";
import { ChevronLeft, Check, Palette } from "lucide-react";
import GlassPanel from "@/components/GlassPanel";
import BottomNavigation from "@/components/BottomNavigation";
import { useTheme } from "@/components/ThemeProvider";
import { accentColorList, backgroundThemeList } from "@/lib/themes";

export default function AppearancePage() {
  const router = useRouter();
  const { backgroundThemeId, accentColorId, setBackgroundThemeId, setAccentColorId, theme } = useTheme();

  return (
    <main className="min-h-screen theme-bg-gradient pb-28">
      <div className="mx-auto w-full max-w-2xl px-4 py-6 sm:px-6">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.back()}
            className="flex h-9 w-9 items-center justify-center rounded-full transition"
            style={{ background: "var(--theme-surface-secondary)", color: "var(--theme-text-primary)" }}
          >
            <ChevronLeft size={18} />
          </button>
          <span className="text-sm font-black tracking-wide" style={{ color: "var(--theme-text-primary)" }}>APPEARANCE</span>
        </div>

        <GlassPanel className="mt-6 rounded-3xl p-5" strong>
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl" style={{ background: "var(--theme-accent-soft)", color: "var(--theme-accent)" }}>
              <Palette size={22} />
            </div>
            <div>
              <h1 className="text-3xl font-black" style={{ color: "var(--theme-text-primary)" }}>Theme</h1>
              <p className="mt-1 text-sm" style={{ color: "var(--theme-text-secondary)" }}>
                Choose a background and accent independently. Changes apply instantly and are saved on this device.
              </p>
            </div>
          </div>

          <div className="mt-5 rounded-3xl border p-4" style={{ background: "var(--theme-bg)", borderColor: "var(--theme-border)" }}>
            <div className="rounded-2xl p-4" style={{ background: "var(--theme-card)", color: "var(--theme-text-primary)" }}>
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-full" style={{ background: "var(--theme-accent)" }} />
                <div>
                  <p className="font-black">Live preview</p>
                  <p className="text-sm" style={{ color: "var(--theme-text-secondary)" }}>{theme.name} · {theme.accent.name}</p>
                </div>
              </div>
              <button className="mt-4 rounded-2xl px-4 py-2 text-sm font-black" style={{ background: "var(--theme-accent)", color: "var(--theme-accent-contrast)" }}>
                Active button
              </button>
            </div>
          </div>
        </GlassPanel>

        <section className="mt-8">
          <p className="mb-4 text-xs font-bold uppercase tracking-widest" style={{ color: "var(--theme-text-subtle)" }}>Background</p>
          <div className="space-y-3">
            {backgroundThemeList.map((item) => {
              const active = item.id === backgroundThemeId;
              return (
                <GlassPanel key={item.id} className="flex cursor-pointer items-center gap-4 rounded-2xl p-4 transition" onClick={() => setBackgroundThemeId(item.id)}>
                  <div className="flex h-12 w-12 shrink-0 overflow-hidden rounded-xl border" style={{ borderColor: "var(--theme-border)" }}>
                    {item.swatch.map((color) => <div key={color} className="h-full flex-1" style={{ background: color }} />)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold" style={{ color: "var(--theme-text-primary)" }}>{item.name}</p>
                  </div>
                  {active && <CheckCircle />}
                </GlassPanel>
              );
            })}
          </div>
        </section>

        <section className="mt-8">
          <p className="mb-4 text-xs font-bold uppercase tracking-widest" style={{ color: "var(--theme-text-subtle)" }}>Accent</p>
          <div className="grid gap-3 sm:grid-cols-3">
            {accentColorList.map((item) => {
              const active = item.id === accentColorId;
              return (
                <button
                  key={item.id}
                  onClick={() => setAccentColorId(item.id)}
                  className="rounded-2xl border p-4 text-left transition active:scale-[0.98]"
                  style={{ background: active ? item.color : "var(--theme-card)", borderColor: active ? item.color : "var(--theme-border)", color: active ? item.contrast : "var(--theme-text-primary)" }}
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-black">{item.name}</span>
                    {active && <Check size={16} />}
                  </div>
                  <div className="mt-3 h-2 rounded-full" style={{ background: active ? item.contrast : item.color }} />
                </button>
              );
            })}
          </div>
        </section>
      </div>
      <BottomNavigation />
    </main>
  );
}

function CheckCircle() {
  return (
    <div className="flex h-7 w-7 items-center justify-center rounded-full" style={{ background: "var(--theme-accent)", color: "var(--theme-accent-contrast)" }}>
      <Check size={15} />
    </div>
  );
}
