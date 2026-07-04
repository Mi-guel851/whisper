"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";

export default function BackButton() {
  const router = useRouter();

  return (
    <button
      onClick={() => router.back()}
      className="mb-6 flex items-center gap-2 text-white/70 hover:text-white"
    >
      <ArrowLeft size={18} />
      Back
    </button>
  );
}