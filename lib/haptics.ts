export function vibrate(pattern: number | number[] = 12) {
  if (typeof window === "undefined") return;
  if (!("vibrate" in navigator)) return;
  try {
    navigator.vibrate(pattern);
  } catch {
    // some browsers throw if called outside a user gesture — ignore
  }
}