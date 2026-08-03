"use client";

import Image from "next/image";

type AuthShellProps = {
  children: React.ReactNode;
  /** Tailwind max-width utility for the card, e.g. "max-w-md". */
  width?: string;
};

/**
 * Edge-lit glass shell shared by every auth screen: aurora backdrop plus the
 * rotating rim-light card. Styling lives in globals.css under `.auth-*`.
 */
export default function AuthShell({ children, width = "max-w-md" }: AuthShellProps) {
  return (
    <main className="auth-shell">
      <div className="auth-aurora" aria-hidden="true">
        <span className="aurora-1" />
        <span className="aurora-2" />
        <span className="aurora-3" />
        <span className="aurora-4" />
      </div>

      <div className={`auth-card ${width}`}>
        <div className="auth-card-inner">{children}</div>
      </div>
    </main>
  );
}

export function AuthBrand() {
  return (
    <div className="auth-brand">
      <Image src="/ghost.png" alt="" width={26} height={26} priority aria-hidden="true" />
      <span>Whisper</span>
    </div>
  );
}
