"use client";

import { ArrowRight, Inbox, Share2 } from "lucide-react";

import DashboardHeader from "@/components/DashboardHeader";
import { ButtonLink } from "@/components/Button";
import WhisperPhoneMockup from "./WhisperPhoneMockup";
import type { DashboardProfile } from "./types";

export default function DashboardHero({ profile }: { profile: DashboardProfile }) {
  return (
    <section className="dashboard-hero" aria-labelledby="dashboard-welcome">
      <div className="dashboard-hero-copy">
        <div id="dashboard-welcome">
          <DashboardHeader profile={profile} />
        </div>
        <p className="dashboard-hero-support">
          Share your link, collect honest thoughts, and join the anonymous conversations moving through Whisper today.
        </p>
        <div className="dashboard-hero-actions">
          <ButtonLink href="/notifications" size="sm" icon={<Inbox size={15} />} iconRight={<ArrowRight size={14} />}>
            Open inbox
          </ButtonLink>
          <a href="#whisper-link" className="dashboard-hero-share-link">
            <Share2 size={15} /> Share my link
          </a>
        </div>
        <div className="dashboard-trust-row" aria-label="Whisper privacy promises">
          <span><i />Anonymous by design</span>
          <span><i />Your link stays yours</span>
          <span><i />Real-time delivery</span>
        </div>
      </div>

      <WhisperPhoneMockup username={profile.username} />
    </section>
  );
}
