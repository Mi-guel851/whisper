"use client";

import Image from "next/image";
import Link from "next/link";
import { ArrowRight, Crown } from "lucide-react";
import DiscoverPeopleCard from "./DiscoverPeopleCard";

export default function DashboardRightRail({ userId }: { userId: string }) {
  return (
    <aside className="dashboard-right-rail" aria-label="More from Whisper">
      {/* The living mark: the Whisper ghost with a soft purple/blue breathing
          glow, for the rail's top slot. Purely decorative (aria-hidden) — its
          job is to make the column feel awake, not to carry information. The
          pulse is box-shadow + halo opacity, never layout, and it stands still
          for reduced-motion users (see `whisper-ghost-glow` in globals.css). */}
      <section className="dashboard-ghost-glow-card" aria-hidden="true">
        <div className="dashboard-ghost-glow">
          <Image
            src="/ghost.png"
            alt=""
            width={72}
            height={72}
            priority={false}
            className="dashboard-ghost-glow-mark"
          />
        </div>
        <p className="dashboard-ghost-glow-caption">Whisper is listening</p>
      </section>

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
