"use client";

import { useRouter } from "next/navigation";
import { ChevronLeft } from "lucide-react";

/**
 * The one back affordance for the whole app.
 *
 * It used to be an arrow plus the word "Back" painted in `text-white/70`, which
 * is a dark-theme assumption baked into a component used on every screen — on
 * the light canvas that resolves to white-on-white and the control disappears.
 * It now reads from the glass tokens, so it picks up whichever theme is active
 * instead of fighting it.
 *
 * The shape is the circular chevron the profile header already used. A round
 * glass chip is self-contained: it stays legible over a photo, a gradient, or a
 * plain canvas, which a bare text link does not.
 */
export default function BackButton({
  label,
  className = "mb-6",
}: {
  /** Optional wordmark or screen title rendered beside the chip. */
  label?: string;
  /** Defaults to the bottom margin every screen previously baked in. */
  className?: string;
}) {
  const router = useRouter();

  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <button
        type="button"
        onClick={() => router.back()}
        aria-label="Go back"
        className="back-chip grid h-9 w-9 shrink-0 place-items-center rounded-full"
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
