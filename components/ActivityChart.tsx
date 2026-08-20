"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Eye, Heart, MessageCircle, TrendingDown, TrendingUp } from "lucide-react";
import { ResponsiveContainer, AreaChart, Area, XAxis, Tooltip } from "recharts";

import { supabase } from "@/lib/supabase/client";
import { getCachedSession } from "@/lib/supabase/session";
import SectionLoadingBar from "./SectionLoadingBar";
import EdgeLitCard from "./EdgeLitCard";

/**
 * The dashboard engagement chart.
 *
 * WHAT THIS USED TO GET WRONG
 *
 *  - **The headline was a hardcoded claim.** It read "Engagement is climbing"
 *    on every render, including the weeks when it was falling and the first week
 *    when there was nothing to climb. A number can be wrong by accident; a
 *    sentence like that is wrong on purpose, and it is the fastest way to teach
 *    someone not to believe the rest of the screen. It is now derived from the
 *    same trend figure the badge shows, and says "quiet" when it is quiet.
 *
 *  - **It polled every 4 seconds.** Two full table reads per user per 4s, *on
 *    top of* realtime subscriptions that already refresh on the exact events
 *    that change the data. The interval could only ever fire between pushes, so
 *    it existed to catch nothing. It is now a slow safety net for a dropped
 *    socket, and the sockets do the real work — which is what "live" should have
 *    meant all along.
 *
 *  - **Views and likes on your posts weren't in it.** They are the two figures
 *    people actually check, and they were absent because they *can't* be read
 *    from the browser: `public_feed_post_views` is RLS'd to the viewer, so an
 *    author cannot see who looked at their own post — by design. The per-day
 *    series comes from `whisper_author_engagement()` instead (migration
 *    202608200002), which is `security definer` and returns counts only.
 *
 * If that migration hasn't been applied the RPC is missing, and rather than
 * showing an empty chart this falls back to the two series the client *can*
 * legitimately read. Fewer real numbers, never invented ones.
 */

type DayBucket = {
  /** ISO date, straight from the server. Also the bucket key. */
  date: string;
  label: string;
  whispers: number;
  profileViews: number;
  postViews: number;
  postLikes: number;
  total: number;
};

const DAYS = 7;

/**
 * Safety net for a dropped realtime socket, not the refresh mechanism.
 *
 * Realtime handles every event that changes these numbers, so this only matters
 * when the socket has quietly died — which is why it can be this slow. The old
 * 4-second interval was ~900 redundant queries an hour per open dashboard.
 */
const FALLBACK_REFRESH_MS = 120_000;

/** Server rows from `whisper_author_engagement`. */
type EngagementRow = {
  day: string;
  whispers: number | string;
  profile_views: number | string;
  post_views: number | string;
  post_likes: number | string;
};

/** Postgres `bigint` arrives as a string over PostgREST. */
function num(value: number | string | null | undefined): number {
  const parsed = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Day labels come from the returned date, so client and server can't disagree
    about which day a bucket is. */
function labelFor(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  if (!y || !m || !d) return "";
  /* Noon local, so a timezone offset can't push the label onto the wrong day. */
  return new Date(y, m - 1, d, 12).toLocaleDateString("en-US", { weekday: "short" });
}

/** Empty scaffold, so the chart has a shape before the first response. */
function emptyDays(): DayBucket[] {
  const days: DayBucket[] = [];
  const today = new Date();
  for (let i = DAYS - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
      d.getDate()
    ).padStart(2, "0")}`;
    days.push({
      date,
      label: labelFor(date),
      whispers: 0,
      profileViews: 0,
      postViews: 0,
      postLikes: 0,
      total: 0,
    });
  }
  return days;
}

/**
 * Percentage change from the first half of the window to the second.
 *
 * The middle day is deliberately excluded from both halves: with an odd window
 * it would otherwise land in one side and bias the comparison by a full day.
 */
function calcTrend(buckets: DayBucket[]): number {
  const half = Math.floor(buckets.length / 2);
  const before = buckets.slice(0, half).reduce((sum, b) => sum + b.total, 0);
  const after = buckets.slice(buckets.length - half).reduce((sum, b) => sum + b.total, 0);
  if (before === 0) return after > 0 ? 100 : 0;
  return Math.round(((after - before) / before) * 100);
}

/** The headline, derived rather than asserted. */
function headlineFor(total: number, trend: number): string {
  if (total === 0) return "No activity yet";
  if (trend > 8) return "Engagement is climbing";
  if (trend < -8) return "Engagement is cooling off";
  return "Engagement is steady";
}

export default function ActivityChart() {
  const [data, setData] = useState<DayBucket[]>(emptyDays);
  const [trend, setTrend] = useState(0);
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  /* Latched off once the RPC turns out to be missing, so an unapplied migration
     costs one failed call rather than one per refresh. */
  const rpcAvailable = useRef(true);
  /* Realtime can push several events in the same instant — a post being liked
     while a whisper lands. Without this each one starts its own reload. */
  const inFlight = useRef(false);

  const loadData = useCallback(async (uid: string) => {
    if (inFlight.current) return;
    inFlight.current = true;

    try {
      const buckets = emptyDays();
      const byDate = new Map(buckets.map((bucket) => [bucket.date, bucket]));

      if (rpcAvailable.current) {
        const { data: rows, error } = await supabase.rpc("whisper_author_engagement", {
          days: DAYS,
        });

        if (error) {
          const missing =
            error.code === "42883" ||
            error.code === "PGRST202" ||
            /could not find the function|does not exist/i.test(error.message ?? "");
          if (missing) {
            rpcAvailable.current = false;
            console.warn(
              "[activity-chart] whisper_author_engagement() not found — showing whispers and profile views only until supabase/migrations/202608200002_author_engagement_series.sql is applied."
            );
          } else {
            console.warn("[activity-chart] engagement query failed:", error.message);
            return;
          }
        } else {
          for (const row of (rows ?? []) as EngagementRow[]) {
            /* The server may format the date as a full timestamp; the first ten
               characters are the ISO day either way. */
            const bucket = byDate.get(String(row.day).slice(0, 10));
            if (!bucket) continue;
            bucket.whispers = num(row.whispers);
            bucket.profileViews = num(row.profile_views);
            bucket.postViews = num(row.post_views);
            bucket.postLikes = num(row.post_likes);
          }
        }
      }

      /* Pre-migration path. Only the two series the browser is actually allowed
         to read, so the card degrades to fewer real numbers rather than to
         invented ones. */
      if (!rpcAvailable.current) {
        const since = buckets[0].date;
        const [{ data: messages }, { data: views }] = await Promise.all([
          supabase
            .from("messages")
            .select("created_at")
            .eq("recipient_id", uid)
            .gte("created_at", since),
          supabase
            .from("profile_views")
            .select("created_at")
            .eq("profile_id", uid)
            .gte("created_at", since),
        ]);

        for (const message of messages ?? []) {
          const bucket = byDate.get(String(message.created_at).slice(0, 10));
          if (bucket) bucket.whispers += 1;
        }
        for (const view of views ?? []) {
          const bucket = byDate.get(String(view.created_at).slice(0, 10));
          if (bucket) bucket.profileViews += 1;
        }
      }

      for (const bucket of buckets) {
        bucket.total =
          bucket.whispers + bucket.profileViews + bucket.postViews + bucket.postLikes;
      }

      setData(buckets);
      setTrend(calcTrend(buckets));
      setLastUpdated(new Date());
      setLoading(false);
    } finally {
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      /* From memory rather than storage — this runs on the dashboard's first
         paint, alongside several other components asking the same question. */
      const session = await getCachedSession();
      if (cancelled) return;

      if (!session) {
        setLoading(false);
        return;
      }

      setUserId(session.user.id);
      void loadData(session.user.id);
    }

    void init();
    return () => {
      cancelled = true;
    };
  }, [loadData]);

  /* One channel, four events — the four things that can move a number on this
     card. Likes and post views are filtered client-side rather than in the
     subscription because the interesting column is the *post's* author, which
     isn't on the like or view row; a reload is cheap and correctness isn't. */
  useEffect(() => {
    if (!userId) return;

    const channel = supabase
      .channel(`activity-chart-${userId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `recipient_id=eq.${userId}`,
        },
        () => void loadData(userId)
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "profile_views",
          filter: `profile_id=eq.${userId}`,
        },
        () => void loadData(userId)
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "public_feed_likes" },
        () => void loadData(userId)
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "public_feed_post_views" },
        () => void loadData(userId)
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [userId, loadData]);

  useEffect(() => {
    if (!userId) return;
    const timer = window.setInterval(() => void loadData(userId), FALLBACK_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [userId, loadData]);

  const totals = data.reduce(
    (sum, bucket) => ({
      whispers: sum.whispers + bucket.whispers,
      views: sum.views + bucket.profileViews + bucket.postViews,
      likes: sum.likes + bucket.postLikes,
      all: sum.all + bucket.total,
    }),
    { whispers: 0, views: 0, likes: 0, all: 0 }
  );

  const rising = trend > 0;

  return (
    <EdgeLitCard radius="3xl" intensity={0.38} speed={17} innerClassName="p-6">
      <SectionLoadingBar loading={loading} />

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="eyebrow text-gray-300">Last 7 days</p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <h2 className="section-title text-white">{headlineFor(totals.all, trend)}</h2>
            <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-emerald-400">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" /> Live
            </span>
          </div>
          {lastUpdated && (
            <p className="mt-1 text-[10px] text-gray-500">
              Updated {lastUpdated.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
            </p>
          )}
        </div>

        {/* Hidden at 0 rather than shown as "+0%": a flat week is what the
            headline already says, and a badge reading zero looks like a bug. */}
        {trend !== 0 && (
          <div
            className={`flex shrink-0 items-center gap-1 rounded-full px-3 py-1.5 text-xs font-black ${
              rising ? "bg-cyan-400/20 text-cyan-400" : "bg-red-400/15 text-red-300"
            }`}
          >
            {rising ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
            {rising ? "+" : ""}
            {trend}%
          </div>
        )}
      </div>

      {/* The three figures the chart is made of, stated plainly. The area plot
          shows the shape of the week; these say what it is made of, which is what
          people actually want off this card. */}
      <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2">
        <span className="flex items-center gap-1.5 text-[12px]">
          <Eye size={13} className="text-cyan-300" />
          <span className="font-black tabular-nums text-white">
            {totals.views.toLocaleString()}
          </span>
          <span className="theme-text-subtle">views</span>
        </span>
        <span className="flex items-center gap-1.5 text-[12px]">
          <Heart size={13} className="text-pink-300" />
          <span className="font-black tabular-nums text-white">
            {totals.likes.toLocaleString()}
          </span>
          <span className="theme-text-subtle">likes</span>
        </span>
        <span className="flex items-center gap-1.5 text-[12px]">
          <MessageCircle size={13} className="text-violet-300" />
          <span className="font-black tabular-nums text-white">
            {totals.whispers.toLocaleString()}
          </span>
          <span className="theme-text-subtle">whispers</span>
        </span>
      </div>

      <ResponsiveContainer width="100%" height={140}>
        <AreaChart data={data} margin={{ top: 16, left: 0, right: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="totalGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#22d3ee" stopOpacity={0.5} />
              <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis dataKey="label" hide />
          <Tooltip
            contentStyle={{
              background: "var(--theme-elevated)",
              border: "1px solid var(--theme-glass-border)",
              borderRadius: "12px",
              color: "var(--theme-text)",
            }}
            /* Named series in the tooltip, so hovering a peak says *what* peaked
               rather than just how tall it was. */
            formatter={(value, _name, item) => {
              const bucket = item?.payload as DayBucket | undefined;
              if (!bucket) return [String(value ?? 0), "activity"];
              return [
                `${bucket.postViews + bucket.profileViews} views · ${bucket.postLikes} likes · ${bucket.whispers} whispers`,
                bucket.label,
              ];
            }}
          />
          <Area
            type="monotone"
            dataKey="total"
            stroke="#22d3ee"
            strokeWidth={3}
            fill="url(#totalGradient)"
            isAnimationActive
            animationDuration={900}
            animationEasing="ease-out"
          />
        </AreaChart>
      </ResponsiveContainer>
    </EdgeLitCard>
  );
}
