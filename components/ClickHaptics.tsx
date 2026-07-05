"use client";

import { useEffect } from "react";
import { vibrate } from "@/lib/haptics";

export default function ClickHaptics() {
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      const target = e.target as HTMLElement;
      const interactive = target.closest("button, a, [role='button'], input[type='submit']");
      if (interactive) {
        vibrate(12);
      }
    }

    document.addEventListener("click", handleClick, true);
    return () => document.removeEventListener("click", handleClick, true);
  }, []);

  return null;
}