"use client";

import { useRouter } from "next/navigation";
import { ChevronLeft } from "lucide-react";

export default function BackButton({
  label,
  className = "mb-6",
}: {
  
  label?: string;
 
  className?: string;
}) {
  const router = useRouter();

  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <button
        type="button"
        onClick={() => router.back()}
        aria-label="Go back"
        className="back-chip glass-control grid h-9 w-9 shrink-0 place-items-center rounded-full"
      >
        <ChevronLeft size={18} />
      </button>

      {label && (
        <span className="back-chip-label truncate text-sm font-black tracking-wide">
          {label}
        </span>
      )}
    </div>
  );
}
