import type { PropsWithChildren } from "react";
import { BlurView } from "expo-blur";
import { View } from "react-native";

export default function GlassCard({ children, className = "", strong = false }: PropsWithChildren<{ className?: string; strong?: boolean }>) {
  return <BlurView intensity={strong ? 42 : 28} tint="dark" className={`overflow-hidden rounded-3xl border border-white/10 ${className}`}><View className={`bg-white/[0.06] p-5 ${strong ? "bg-black/35" : ""}`}>{children}</View></BlurView>;
}