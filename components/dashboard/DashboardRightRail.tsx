"use client";

import Link from "next/link";
import { ArrowRight, Crown } from "lucide-react";
import DiscoverPeopleCard from "./DiscoverPeopleCard";

export default function DashboardRightRail({ userId }: { userId: string }) {
  return (
    <aside className="dashboard-right-rail" aria-label="More from Whisper">
      <section className="dashboard-upgrade-card" aria-labelledby="dashboard-upgrade-title">
        <span className="dashboard-upgrade-crown"><Crown size={22} /></span>
        <div>
          <h2 id="dashboard-upgrade-title">Whisper Premium</h2>
          <p>Get more coins, images, and expressive ways to connect.</p>
        </div>
        <Link href="/premium">Explore Premium <ArrowRight size={13} /></Link>
      </section>

      <DiscoverPeopleCard myId={userId} />
    </aside>
  );
}
