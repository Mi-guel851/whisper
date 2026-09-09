"use client";

import Link from "next/link";
import { ArrowRight, Crown, Flame, Sparkles } from "lucide-react";

import StatsRow from "@/components/StatsRow";
import DiscoverPeopleCard from "./DiscoverPeopleCard";
import type { DashboardTopic } from "./types";

export default function DashboardRightRail({
  userId,
  topics,
  loadingTopics,
}: {
  userId: string;
  topics: DashboardTopic[];
  loadingTopics: boolean;
}) {
  return (
    <aside className="dashboard-right-rail" aria-label="Dashboard insights">
      <section className="dashboard-rail-card dashboard-stats-panel" aria-labelledby="quick-stats-title">
        <div className="dashboard-rail-heading">
          <div><span className="dashboard-rail-icon"><Sparkles size={15} /></span><h2 id="quick-stats-title">Quick stats</h2></div>
          <Link href="#engagement">View details <ArrowRight size={12} /></Link>
        </div>
        <StatsRow variant="compact" initialUserId={userId} live={false} />
      </section>

      <section className="dashboard-rail-card" aria-labelledby="trending-topics-title">
        <div className="dashboard-rail-heading">
          <div><span className="dashboard-rail-icon is-pink"><Flame size={15} /></span><h2 id="trending-topics-title">Trending topics</h2></div>
          <Link href="/public-feed?sort=trending">View all <ArrowRight size={12} /></Link>
        </div>
        <div className="dashboard-topic-list" aria-busy={loadingTopics}>
          {loadingTopics ? (
            Array.from({ length: 4 }).map((_, index) => <div className="dashboard-topic-skeleton" key={index}><i /><span /></div>)
          ) : topics.length > 0 ? (
            topics.map((topic, index) => (
              <Link href={`/public-feed?topic=${topic.key}&sort=trending`} key={topic.key}>
                <span className={`dashboard-topic-rank rank-${index + 1}`}>{index + 1}</span>
                <span className="dashboard-topic-emoji" aria-hidden>{topic.emoji}</span>
                <span className="min-w-0 flex-1"><strong>{topic.label}</strong><small>{topic.activity.toLocaleString()} interactions in this feed</small></span>
                <ArrowRight size={13} />
              </Link>
            ))
          ) : (
            <div className="dashboard-topic-empty">Topics will appear as the community starts posting.</div>
          )}
        </div>
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
