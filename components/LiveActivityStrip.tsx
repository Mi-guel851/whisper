"use client";

import { useEffect, useRef, useState } from "react";
import { motion, useMotionValue, useSpring, useTransform } from "framer-motion";
import { Activity, Eye, MessageCircle } from "lucide-react";

import { supabase } from "@/lib/supabase/client";
import { presenceManager } from "@/lib/realtime/presence";
import { getCachedSession } from "@/lib/supabase/session";
import useSafeReducedMotion from "@/lib/useSafeReducedMotion";
import { tween } from "@/lib/motion";

/**
 * Live Whisper activity.
 *
 * EVERY NUMBER HERE IS REAL, OR IT IS NOT SHOWN.
 *
 * That is the whole design constraint. A row of invented counters is the fastest
 * way to make a product feel like a demo, and it is a lie the user can catch — a
 * new app claiming 12,438 whispers today is transparently fabricated, and once one
 * number is doubted the rest of the interface is too.
 *
 * The counts come from `whisper_live_activity()`, a `security definer` function
 * (202608200001) that returns aggregates and nothing else. They are *not* read
 * with a client-side `count` on `messages`, which is the obvious approach and a
 * subtly wrong one: RLS limits every reader to their own rows, so that count is
 * the user's own inbox wearing a platform-wide label.
 *
 * Two consequences, both handled by hiding rather than by inventing:
 *
 *  - If the migration hasn't been applied, the RPC is missing and the strip
 *    renders nothing at all. It never falls back to a number it can't stand
 *    behind.
 *  - Early on the real figures are small, and "3 whispers today" reads as dead.
 *    `MIN_TO_SHOW` is the floor below which a stat stays unsaid.
 *
 * "Whispering now" is the one figure not from the RPC: it is the length of the
 * presence roster that already powers the green dots elsewhere. Length only —
 * never who.
 */

/** Below this, a stat stays hidden rather than advertising how quiet it is. */
const MIN_TO_SHOW = 8;

/**
 * How often the counts refresh.
 *
 * Long on purpose. These are ambient figures nobody watches tick, and a tight
 * interval would put an aggregate query per user per few seconds on the database
 * for a decorative strip.
 */
const REFRESH_MS = 90_000;

type ActivityCounts = {
  whispers_today?: number;
  conversations_total?: number;
};

/**
 * A number that rolls to its new value.
 *
 * `useSpring` rather than an interval stepping the value: the spring is
 * interruptible, so a refresh landing mid-count redirects smoothly instead of
 * restarting, and it runs on Framer's own frame loop rather than scheduling a
 * React render per tick.
 */
function Ticker({ value }: { value: number }) {
  const motionValue = useMotionValue(0);
  const spring = useSpring(motionValue, { stiffness: 90, damping: 24, mass: 1 });
  const text = useTransform(spring, (latest) => Math.round(latest).toLocaleString());

  useEffect(() => {
    motionValue.set(value);
  }, [value, motionValue]);

  return <motion.span className="tabular-nums">{text}</motion.span>;
}

export default function LiveActivityStrip() {
  const reduced = useSafeReducedMotion();

  const [counts, setCounts] = useState<ActivityCounts | null>(null);
  const [online, setOnline] = useState<number | null>(null);

  /* Latched off permanently once the RPC turns out to be missing, so an unapplied
     migration costs one failed call rather than one every 90 seconds. */
  const available = useRef(true);
  const inFlight = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;
    let unsubscribePresence: (() => void) | undefined;

    async function loadCounts() {
      if (!available.current || inFlight.current) return;
      inFlight.current = true;

      try {
        const { data, error } = await supabase.rpc("whisper_live_activity");

        if (cancelled) return;

        if (error) {
          /* 42883 / PGRST202 both mean "no such function" — the migration hasn't
             run. Anything else is transient, so the previous values stay and the
             next tick retries. */
          const missing =
            error.code === "42883" ||
            error.code === "PGRST202" ||
            /could not find the function|does not exist/i.test(error.message ?? "");

          if (missing) {
            available.current = false;
            console.warn(
              "[live-activity] whisper_live_activity() not found — the activity strip stays hidden until supabase/migrations/202608200001_live_activity_aggregates.sql is applied."
            );
          } else {
            console.warn("[live-activity] aggregate query failed:", error.message);
          }
          return;
        }

        setCounts((data ?? {}) as ActivityCounts);
      } finally {
        inFlight.current = false;
      }
    }

    async function start() {
      await loadCounts();
      if (cancelled) return;

      /* The presence channel is already connected for the nav badges and the
         Friends roster, so this adds a listener rather than a socket. */
      unsubscribePresence = presenceManager.subscribe((users) => {
        if (!cancelled) setOnline(users.length);
      });

      const session = await getCachedSession();
      if (session && !cancelled) void presenceManager.connect(session.user.id);

      if (available.current) {
        timer = window.setInterval(() => void loadCounts(), REFRESH_MS);
      }
    }

    void start();

    return () => {
      cancelled = true;
      if (timer !== null) window.clearInterval(timer);
      unsubscribePresence?.();
    };
  }, []);

  const stats = [
    {
      key: "whispers",
      icon: MessageCircle,
      value: typeof counts?.whispers_today === "number" ? counts.whispers_today : null,
      label: "whispers today",
      tint: "text-cyan-300",
    },
    {
      key: "online",
      icon: Eye,
      value: online,
      label: "whispering now",
      tint: "text-emerald-300",
    },
    {
      key: "conversations",
      icon: Activity,
      value:
        typeof counts?.conversations_total === "number" ? counts.conversations_total : null,
      label: "conversations",
      tint: "text-pink-300",
    },
  ];

  const visible = stats.filter(
    (stat): stat is typeof stat & { value: number } =>
      stat.value !== null && stat.value >= MIN_TO_SHOW
  );

  if (visible.length === 0) return null;

  return (
    <motion.div
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={tween.base}
      className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2"
      aria-label="Live Whisper activity"
    >
      {visible.map((stat) => {
        const Icon = stat.icon;
        return (
          <span key={stat.key} className="flex items-center gap-1.5 text-[12px]">
            <Icon size={13} className={stat.tint} />
            <span className="font-black text-white">
              {/* Reduced motion gets the number, not the roll. A counting
                  animation is exactly the non-essential motion the setting is
                  asking us to drop. */}
              {reduced ? stat.value.toLocaleString() : <Ticker value={stat.value} />}
            </span>
            <span className="theme-text-subtle">{stat.label}</span>
          </span>
        );
      })}
    </motion.div>
  );
}
