"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  House,
  MessageCircle,
  Bell,
  User,
} from "lucide-react";

export default function BottomNavigation() {
  const pathname = usePathname();

  const nav = [
    {
      href: "/dashboard",
      icon: House,
    },
    {
      href: "/inbox",
      icon: MessageCircle,
    },
    {
      href: "/notifications",
      icon: Bell,
    },
    {
      href: "/profile",
      icon: User,
    },
  ];

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 border-t border-white/10 bg-[#090014]/90 backdrop-blur-xl">

      <div className="mx-auto flex max-w-lg justify-around py-3">

        {nav.map((item) => {
          const Icon = item.icon;

          const active = pathname.startsWith(item.href);

          return (
            <Link
              key={item.href}
              href={item.href}
              className={`transition duration-300 ${
                active
                  ? "text-cyan-400"
                  : "text-gray-500 hover:text-white"
              }`}
            >
              <Icon
                size={27}
                strokeWidth={2.3}
              />
            </Link>
          );
        })}

      </div>

    </div>
  );
}