"use client";

import Image from "next/image";

export default function DashboardHeader() {
  return (
    <div className="mb-8 flex items-center justify-between">

      <div>

        <h1 className="flex items-center gap-3 text-4xl font-black text-white">

          Welcome

          <Image
            src="/ghost.png"
            alt="wave"
            width={34}
            height={34}
            className="animate-bounce"
          />

        </h1>

        <p className="mt-2 text-gray-400">
          Ready to receive anonymous messages.
        </p>

      </div>

    </div>
  );
}