"use client";

import { useEffect, useState } from "react";

export default function Background() {
  const [scrollY, setScrollY] = useState(0);

  useEffect(() => {
    function handleScroll() {
      setScrollY(window.scrollY);
    }
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <div className="fixed inset-0 -z-10 overflow-hidden theme-bg-gradient">

      <div
        className="absolute -left-40 -top-40 h-[500px] w-[500px] rounded-full blur-[180px] animate-pulse transition-transform duration-100 ease-out"
        style={{ background: "var(--theme-blob-1)", transform: `translateY(${scrollY * 0.15}px)` }}
      />

      <div
        className="absolute right-[-120px] top-[80px] h-[420px] w-[420px] rounded-full blur-[180px] animate-pulse transition-transform duration-100 ease-out"
        style={{ background: "var(--theme-blob-2)", transform: `translateY(${scrollY * -0.1}px)` }}
      />

      <div
        className="absolute bottom-[-180px] left-1/2 h-[550px] w-[550px] -translate-x-1/2 rounded-full blur-[220px] transition-transform duration-100 ease-out"
        style={{ background: "var(--theme-blob-3)", transform: `translate(-50%, ${scrollY * 0.25}px)` }}
      />

      <div
        className="absolute inset-0 opacity-[0.05]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,.25) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.25) 1px, transparent 1px)",
          backgroundSize: "50px 50px",
          transform: `translateY(${scrollY * 0.05}px)`,
        }}
      />

    </div>
  );
}