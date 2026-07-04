"use client";

import { useEffect, useState } from "react";
import Image from "next/image";

export default function SplashScreen() {
  const [show, setShow] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      setShow(false);
    }, 2500);

    return () => clearTimeout(timer);
  }, []);

  if (!show) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-[#05000f]">

      <div className="text-center">

        <Image
          src="/ghost.png"
          alt="Whisper"
          width={180}
          height={180}
          priority
          className="animate-bounce drop-shadow-[0_0_50px_rgba(34,211,238,.9)]"
        />

        <h1 className="mt-6 text-5xl font-black text-white">
          Whisper
        </h1>

        <div className="mt-6 h-2 w-56 overflow-hidden rounded-full bg-white/10">

          <div className="h-full w-full animate-[loading_2.5s_linear] bg-gradient-to-r from-cyan-400 to-purple-500" />

        </div>

      </div>

      <style jsx>{`
        @keyframes loading {
          from {
            transform: translateX(-100%);
          }
          to {
            transform: translateX(0%);
          }
        }
      `}</style>

    </div>
  );
}