"use client";

import Image from "next/image";

export default function Ghost() {
  return (
    <div className="relative flex items-center justify-center">

      <div className="absolute h-96 w-96 rounded-full bg-cyan-500/20 blur-[140px] animate-pulse" />

      <Image
        src="/ghost.png"
        alt="Ghost"
        width={340}
        height={340}
        priority
        className="relative z-10 animate-[float_4s_ease-in-out_infinite] drop-shadow-[0_0_60px_rgba(34,211,238,0.8)]"
      />

      <style jsx>{`
        @keyframes float {
          0% {
            transform: translateY(0px);
          }
          50% {
            transform: translateY(-28px);
          }
          100% {
            transform: translateY(0px);
          }
        }
      `}</style>

    </div>
  );
}