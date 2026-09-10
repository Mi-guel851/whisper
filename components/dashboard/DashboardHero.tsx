"use client";

import { ArrowRight, Inbox, Share2 } from "lucide-react";
import { ButtonLink } from "@/components/Button";
import StreakChip from "@/components/StreakChip";
import type { DashboardProfile } from "./types";

export default function DashboardHero({ profile }: { profile: DashboardProfile }) {
  return (
    <section className="dashboard-hero dashboard-welcome-card" aria-labelledby="dashboard-welcome">
      <div className="dashboard-welcome-top">
        <span className="dashboard-welcome-eyebrow">YOUR LITTLE CORNER OF WHISPER</span>
        <StreakChip />
      </div>
      <div className="dashboard-welcome-copy">
        <h1 id="dashboard-welcome">Hey, {profile.display_name || profile.username} <span aria-hidden>✦</span></h1>
        <p>Your inbox is open. Let the honest thoughts in.</p>
      </div>
      <div className="dashboard-hero-actions">
        <ButtonLink href="/notifications" size="sm" icon={<Inbox size={16} />} iconRight={<ArrowRight size={15} />}>
          Open whispers
        </ButtonLink>
        <a href="#whisper-link" className="dashboard-hero-share-link">
          <Share2 size={16} /> Share my link
        </a>
      </div>
    </section>
  );
}
