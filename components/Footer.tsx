"use client";

import Image from "next/image";

export default function Footer() {
  return (
    <footer className="border-t border-white/10 px-8 py-10">
      <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 md:flex-row">

        <div className="flex items-center gap-2">
          <Image src="/ghost.png" alt="Whisper" width={28} height={28} />
          <span className="font-bold text-white">Whisper</span>
        </div>

        <p className="text-sm text-gray-500">
          © {new Date().getFullYear()} Whisper. Anonymous messaging, done right.
        </p>

      </div>
    </footer>
  );
}