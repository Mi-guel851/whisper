"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import Image from "next/image";
import { motion } from "framer-motion";
import { Heart, Sparkles } from "lucide-react";

import { getCachedSession } from "@/lib/supabase/session";
import { activeSocialLinks, type SocialLink } from "@/lib/socialLinks";
import SocialIcon, { SOCIAL_LABELS, SOCIAL_SURFACES } from "@/components/SocialIcon";
import useSafeReducedMotion from "@/lib/useSafeReducedMotion";
import { spring, tween } from "@/lib/motion";
import { assistantHiddenOn } from "@/lib/ai/pageContext";
import Button from "./Button";
import Modal from "./Modal";

/**
 * The once-a-day "follow Whisper" prompt.
 *
 * WHY ONCE A DAY, AND WHY IT IS ALLOWED TO BE
 *
 * A prompt that interrupts every visit is an ad. A prompt that appears once per
 * calendar day, dismisses in one tap, and stops appearing once the user has tapped
 * through to a platform is a reminder — and the difference between the two is
 * entirely in the frequency cap, so the cap is the most important code in this
 * file. Three rules enforce it:
 *
 *   1. Once per *local calendar day*, keyed on the date string. Not a rolling
 *      24-hour timer: a timer set by a 9pm visit fires again at 9pm the next day,
 *      which is a second interruption on the same evening.
 *   2. Never on the first ~4.5 seconds of a load. Somebody who opened the app to
 *      read one message should get to read it first; a dialog that lands on top of
 *      the content they came for is the version of this feature everyone hates.
 *   3. Never again once they have actually followed through — `FOLLOWED_KEY` is a
 *      permanent opt-out written the moment a tile is tapped. Asking someone to
 *      follow an account they already opened is the fastest way to make the app
 *      feel like it isn't paying attention.
 *
 * It is also gated to signed-in users on in-app routes only: it must never land on
 * the marketing page, an auth screen, a chat, or — most importantly — the public
 * anonymous-send page, where the visitor is a stranger doing someone else a favour
 * and being sold to would be a genuinely bad first impression.
 *
 * If `lib/socialLinks.ts` still has no real URLs in it, this renders nothing at
 * all. See the note there: a follow prompt with dead tiles is worse than no prompt.
 */

const SHOWN_KEY = "whisper-social-prompt-day";
const FOLLOWED_KEY = "whisper-social-followed";

/** Local calendar day, not UTC — "today" has to mean the user's today. */
function todayKey(): string {
  const now = new Date();
  const month = `${now.getMonth() + 1}`.padStart(2, "0");
  const day = `${now.getDate()}`.padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

/** Long enough that the user has read whatever they opened the app for. */
const APPEAR_DELAY_MS = 4500;

function readFlag(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    /* Private mode or storage disabled. Returning null here would make the prompt
       fire on every single navigation, so the caller treats a throw as "already
       shown" — the frequency cap is the feature, and a cap we cannot persist is a
       cap we cannot honour. */
    return "unavailable";
  }
}

function writeFlag(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* Nothing to do — see readFlag. */
  }
}

export default function SocialFollowPrompt() {
  const pathname = usePathname();
  const reduced = useSafeReducedMotion();
  const [open, setOpen] = useState(false);

  /* Computed once: the config is a module constant, so re-filtering it on every
     render would be pure waste on a component that mounts in the root layout. */
  const links = useMemo(() => activeSocialLinks(), []);

  /* Reuses the assistant's route list rather than keeping a second copy that can
     drift — the set of routes where a floating panel is unwelcome is the same set. */
  const routeAllowed = !assistantHiddenOn(pathname);

  useEffect(() => {
    if (links.length === 0 || !routeAllowed) return;

    const today = todayKey();
    if (readFlag(FOLLOWED_KEY) === "true") return;
    if (readFlag(SHOWN_KEY) === today) return;

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      /* Session check inside the timeout, not before it: `getCachedSession` may
         hit the network on a cold load, and doing it up front would race the
         delay we deliberately introduced. */
      const session = await getCachedSession();
      if (cancelled || !session) return;

      /* Re-read: a second tab may have shown it during the delay. */
      if (readFlag(SHOWN_KEY) === today) return;
      writeFlag(SHOWN_KEY, today);
      setOpen(true);
    }, APPEAR_DELAY_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
    /* Deliberately keyed on the route *category*, not `pathname`: re-running this
       on every navigation would restart the timer each time and mean a user who
       browses steadily never sits still long enough to see it. */
  }, [links.length, routeAllowed]);

  const close = useCallback(() => setOpen(false), []);

  /* Tapping a tile is the permanent opt-out. The dialog closes with it so the
     user returns to a clean screen rather than to a prompt asking them to do the
     thing they just did. */
  const handleFollow = useCallback((link: SocialLink) => {
    writeFlag(FOLLOWED_KEY, "true");
    setOpen(false);
    /* `noopener` is not optional on a target=_blank link to a third party: without
       it the opened tab gets a handle on `window.opener` and can navigate this one. */
    window.open(link.url, "_blank", "noopener,noreferrer");
  }, []);

  if (links.length === 0) return null;

  return (
    <Modal open={open} onClose={close} size="sm" showClose className="overflow-hidden">
      <div className="relative px-6 pb-6 pt-8 text-center">
        {/* Brand wash behind the ghost. Same radial-over-panel treatment as the
            streak payout dialog, in Whisper's purple rather than amber, so the two
            celebratory dialogs read as the same family. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-40"
          style={{
            background:
              "radial-gradient(58% 68% at 50% 0%, rgba(167,139,250,0.24) 0%, rgba(192,68,145,0.10) 44%, transparent 74%)",
          }}
        />

        <motion.div
          initial={reduced ? { opacity: 0 } : { scale: 0.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={reduced ? tween.base : spring.snappy}
          className="relative mx-auto grid h-16 w-16 place-items-center rounded-[1.35rem]"
          style={{
            background: "linear-gradient(140deg, #22d3ee 0%, #a78bfa 52%, #c04491 100%)",
            boxShadow:
              "0 10px 28px rgba(167,139,250,0.32), inset 0 1px 0 rgba(255,255,255,0.42)",
          }}
        >
          <Image src="/ghost.png" alt="" width={34} height={34} aria-hidden />
          {/* One small orbiting spark rather than a shower. The brief rules out
              motion that feels excessive, and this dialog opens uninvited — it has
              to earn attention quietly. */}
          {!reduced && (
            <motion.span
              aria-hidden
              className="absolute -right-1.5 -top-1.5 grid h-6 w-6 place-items-center rounded-full bg-white text-[#7c3aed] shadow-md"
              animate={{ scale: [1, 1.14, 1], rotate: [0, 12, 0] }}
              transition={{ duration: 2.6, repeat: Infinity, ease: "easeInOut" }}
            >
              <Sparkles size={13} />
            </motion.span>
          )}
        </motion.div>

        <motion.div
          initial={reduced ? { opacity: 0 } : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={reduced ? tween.base : { ...tween.base, delay: 0.1 }}
        >
          <h2 className="mt-4 text-[1.3rem] font-black leading-tight text-white">
            Whisper is better with you
          </h2>
          <p className="mx-auto mt-2 max-w-[17rem] text-[13px] leading-relaxed theme-text-muted">
            Follow us for new features, prompts and drops before anyone else.
          </p>

          {/* One row, wrapping. A grid with a fixed column count would leave a
              lone tile stranded on its own line when a platform is unconfigured. */}
          <div className="mt-5 flex flex-wrap items-start justify-center gap-3">
            {links.map((link, i) => {
              const surface = SOCIAL_SURFACES[link.platform];
              const label = SOCIAL_LABELS[link.platform];
              return (
                <motion.button
                  key={link.platform}
                  type="button"
                  onClick={() => handleFollow(link)}
                  aria-label={`Follow Whisper on ${label}`}
                  className="group flex w-[4.5rem] flex-col items-center gap-2 rounded-2xl p-1.5 outline-none"
                  initial={reduced ? { opacity: 0 } : { opacity: 0, y: 10, scale: 0.9 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={
                    reduced ? tween.base : { ...spring.snappy, delay: 0.16 + i * 0.05 }
                  }
                  whileTap={reduced ? undefined : { scale: 0.93 }}
                >
                  <span
                    className="grid h-12 w-12 place-items-center rounded-2xl transition-transform duration-200 group-hover:-translate-y-0.5"
                    style={{
                      background: surface.bg,
                      color: surface.fg,
                      /* The rim is what stops X's and TikTok's pure black from
                         disappearing into a dark panel. */
                      boxShadow:
                        "0 6px 16px rgba(0,0,0,0.28), inset 0 0 0 1px rgba(255,255,255,0.16)",
                    }}
                  >
                    <SocialIcon platform={link.platform} size={22} />
                  </span>
                  <span className="w-full truncate text-[10.5px] font-bold leading-none theme-text-muted">
                    {link.handle || label}
                  </span>
                </motion.button>
              );
            })}
          </div>

          <Button className="mt-6" size="md" fullWidth onClick={close}>
            Maybe later
          </Button>

          <p className="mt-3 inline-flex items-center gap-1.5 text-[11px] theme-text-subtle">
            <Heart size={11} />
            We&apos;ll only ask once a day
          </p>
        </motion.div>
      </div>
    </Modal>
  );
}
