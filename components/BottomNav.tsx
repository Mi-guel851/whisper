"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function BottomNav() {
  const pathname = usePathname();

  const item = (href: string, icon: string, label: string) => (
    <Link
      href={href}
      className={`flex flex-col items-center ${
        pathname === href ? "text-cyan-400" : "text-gray-400"
      }`}
    >
      <span className="text-2xl">{icon}</span>
      <span className="text-xs mt-1">{label}</span>
    </Link>
  );

  return (
    <div className="fixed bottom-0 left-0 right-0 border-t border-white/10 bg-[#090014]/90 backdrop-blur-xl">

      <div className="mx-auto flex max-w-lg justify-around py-4">

        {item("/dashboard", "🏠", "Home")}

        {item("/inbox", "📥", "Inbox")}

        {item("/profile", "👤", "Profile")}

        {item("/setup", "⚙️", "Settings")}

      </div>

    </div>
  );
}