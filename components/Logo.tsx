"use client";

import Image from "next/image";

export default function Logo() {
  return (
    <div className="flex items-center gap-3">

      <Image
        src="/ghost.png"
        alt="Whisper"
        width={48}
        height={48}
        priority
        className="animate-pulse drop-shadow-[0_0_18px_rgba(34,211,238,.9)]"
      />

      <div>
        <h1 className="text-3xl font-black text-white">
          Whisper
        </h1>

        <p className="text-cyan-300 text-sm">
          Anonymous Messaging
        </p>
      </div>

    </div>
  );
}