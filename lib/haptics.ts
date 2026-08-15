import { Capacitor } from "@capacitor/core";

export async function vibrate(pattern: number | number[] = 12) {
  if (typeof window === "undefined") return;

  // 1. Try Native Capacitor Haptics first (Premium Feel)
  if (Capacitor.isNativePlatform()) {
    try {
      const { Haptics, ImpactStyle } = await import("@capacitor/haptics").catch(() => ({ Haptics: null, ImpactStyle: null })) as any;
      // For short clicks, use light impact
      if (typeof pattern === "number" && pattern <= 15) {
        await Haptics.impact({ style: ImpactStyle.Light });
      } else {
        await Haptics.vibrate({ duration: typeof pattern === "number" ? pattern : pattern[0] });
      }
      return;
    } catch (err) {
      console.error("Native haptics failed, falling back to browser:", err);
    }
  }

  // 2. Fallback to Browser Vibrate API
  if ("vibrate" in navigator) {
    try {
      navigator.vibrate(pattern);
    } catch {
      // ignore
    }
  }
}