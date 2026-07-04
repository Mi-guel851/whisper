"use client";

import { Bell, ShieldCheck } from "lucide-react";

export default function NotificationCard() {
  return (
    <div className="rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur-2xl">

      <div className="mb-5 flex items-center gap-3">

        <Bell className="text-yellow-400" />

        <h2 className="text-2xl font-bold text-white">
          Notifications
        </h2>

      </div>

      <div className="space-y-4">

        <div className="rounded-2xl bg-white/5 p-4">

          <div className="flex items-center gap-2">

            <ShieldCheck
              size={18}
              className="text-green-400"
            />

            <span className="font-semibold text-white">
              Security
            </span>

          </div>

          <p className="mt-2 text-gray-400">
            Your account is fully protected.
          </p>

        </div>

        <div className="rounded-2xl bg-cyan-500/10 p-4">

          <p className="font-semibold text-cyan-300">
            🎉 Premium features coming soon!
          </p>

        </div>

      </div>

    </div>
  );
}