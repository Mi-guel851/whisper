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
 * EVERY NUMBER HERE IS REAL.
 *
 * That is the whole design constraint. A row of invented counters is the single
 * fastest way to make a product feel like a demo, and worse, it is a lie the user
 * can catch — a brand new app claiming 12,438 whispers today is obviously
 * fabricated, and once one number is doubted the rest of the interface is too.
 *
 * So: whispers today comes from a `head: true` count on the real table, people
 * whispering now comes from the presence channel that already powers the green
 * dots in Friends and Inbox, and conversations comes from a count of rows in
 * `conversations`. Nothing is scaled, padded, or seeded.
 *
 * The consequence is that early on the numbers are small. That is handled by
 * hiding the strip entirely below a floor rather than by inflating it — "3
 * whispers sent today" reads as dead, so it is better left unsaid until there is
 * something worth saying. `MIN_TO_SHOW` is where that line sits.
 *
 * Aggregates only. No row here is attributable to a person: counts are counts,
 * and the presence figure is a roster length, never a list of who.
 */

/** Below this, the strip stays hidden rather than advertising how quiet it is. */
const MIN_TO_SHOW = 8;

/** How often the counts refresh. Long on purpose — see the note in the effect. */
const REFRESH_MS = 90_000;

type Stat = {
  key: string;
  icon: typeof Eye;
  value: number | null;
  label: string;
  tint: string;
};

/**
 * A number that rolls to its new value.
 *
 * `useSpring` rather than an interval that steps the number: the spring is
 * interruptible, so a refresh landing mid-count redirects smoothly instead of
 * restarting, and it runs on Framer's frame loop rather than scheduling React
 * renders per tick.
 */
function Ticker({ value, reduced }: { value: number; reduced: boolean }) {
  const motionValue = useMotionValue(0);
  const spring = useSpring(motionValue, { stiffness: 90, damping: 24, mass: 1 });
  const text = useTransform(spring, (latest) => Math.round(latest).toLocaleString());

  useEffect(() => {
    if (reduced) {
      /* Jump straight there. A counting animation is exactly the kind of
         non-essential motion prefers-reduced-motion is asking us to drop. */
      motionValue.set(value);
      spring.jump(value);
      return;
    }
    motionValue.set(value);
  }, [value, reduced, motionValue, spring]);

  return <motion.span className="tabular-nums">{text}</motion.span>;
}

export default function LiveActivityStrip() {
  const reduced = useSafeReducedMotion();

  const [whispersToday, setWhispersToday] = useState<number | null>(null);
  const [conversations, setConversations] = useState<number | null>(null);
  const [online, setOnline] = useState<number | null>(null);

  /* Guards the refresh loop against overlapping runs on a slow connection. */
  const inFlight = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;
    let unsubscribePresence: (() => void) | undefined;

    async function loadCounts() {
      if (inFlight.current) return;
      inFlight.current = true;

      try {
        /* Local midnight, not UTC — "today" has to mean the user's today or the
           number is wrong for most of the world for most of the day. */
        const midnight = new Date();
        midnight.setHours(0, 0, 0, 0);
        const since = midnight.toISOString();

        /* `head: true` with an exact count returns no rows at all, so this costs a
           count on the index rather than transferring the table. Both run
           together because neither depends on the other. */
        const [whisperCount, conversationCount] = await Promise.all([
          supabase
            .from("messages")
            .select("id", { count: "exact", head: true })
            .gte("created_at", since),
          supabase.from("conversations").select("id", { count: "exact", head: true }),
        ]);

        if (cancelled) return;

        /* A failed count leaves the previous value alone rather than flashing a
           zero. An error here is almost always RLS or a renamed table, and
           showing "0 whispers today" would misreport it as inactivity. */
        if (!whisperCount.error) setWhispersToday(whisperCount.count ?? 0);
        else console.warn("[live-activity] whisper count failed:", whisperCount.error.message);

        if (!conversationCount.error) setConversations(conversationCount.count ?? 0);
        else console.warn("[live-activity] conversation count failed:", conversationCount.error.message);
      } finally {
        inFlight.current = false;
      }
    }

    async function start() {
      await loadCounts();
      if (cancelled) return;

      /* The presence channel is already connected for the nav badges and the
         Friends roster, so subscribing here adds a listener rather than a socket.
         Only the roster's *length* is read — never its contents. */
      unsubscribePresence = presenceManager.subscribe((users) => {
        if (!cancelled) setOnline(users.length);
      });

      const session = await getCachedSession();
      if (session && !cancelled) void presenceManager.connect(session.user.id);

      /* 90 seconds, not 5. These are ambient figures nobody is watching tick, and
         a tight interval would put two COUNT queries per user per few seconds on
         the database for a decorative strip. */
      timer = window.setInterval(() => void loadCounts(), REFRESH_MS);
    }

    void start();

    return () => {
      cancelled = true;
      if (timer !== null) window.clearInterval(timer);
      unsubscribePresence?.();
    };
  }, []);

  const stats: Stat[] = [
    {
      key: "whispers",
      icon: MessageCircle,
      value: whispersToday,
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
      value: conversations,
      label: "conversations",
      tint: "text-pink-300",
    },
  ];

  /* Only stats that have both loaded and cleared the floor. A strip with one
      honest number is better than three with two placeholders. */
  const visible = stats.filter((stat) => stat.value !== null && stat.value >= MIN_TO_SHOW);

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
              <Ticker value={stat.value as number} reduced={Boolean(reduced)} />
            </span>
            <span className="theme-text-subtle">{stat.label}</span>
          </span>
        );
      })}
    </motion.div>
  );
}
