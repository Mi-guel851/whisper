"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import Image from "next/image";
import { motion } from "framer-motion";
import { Check, Heart, Sparkles } from "lucide-react";

import { getCachedSession, onSessionChange } from "@/lib/supabase/session";
import { activeSocialLinks, type SocialLink } from "@/lib/socialLinks";
import SocialIcon, { SOCIAL_LABELS, SOCIAL_SURFACES } from "@/components/SocialIcon";
import useSafeReducedMotion from "@/lib/useSafeReducedMotion";
import { spring, tween } from "@/lib/motion";
import { notifyIntroSettled } from "@/lib/introPrompts";
import { assistantHiddenOn } from "@/lib/ai/pageContext";
import Button from "./Button";
import Modal from "./Modal";

/**
 * The "follow Whisper" prompt that greets a signed-in user each time they open
 * the app.
 *
 * WHY THE CADENCE IS PER APP-OPEN, NOT ONCE A DAY
 *
 * This started as a once-per-calendar-day prompt with a permanent opt-out the
 * moment any tile was tapped, and both caps turned out to be wrong for what this
 * is meant to do. The brief is a reminder that shows up when someone comes back to
 * Whisper — and a cap keyed on the date means logging out and back in, or closing
 * and reopening the app, shows nothing at all. The permanent opt-out was worse: one
 * curious tap silenced the prompt on that device forever, which is indistinguishable
 * from the feature being broken.
 *
 * So the frequency cap is now three narrower rules, in this order:
 *
 *   1. Once per app open. `shownThisRuntime` is module state, so it resets on a real
 *      page load or app launch and survives client-side navigation — browsing from
 *      the dashboard to friends and back does not re-open it.
 *   2. A 30-minute floor between showings, so reloading the page a few times in a
 *      row is not punished. Deliberately short: "opens the app again later" has to
 *      still count as again.
 *   3. Signing in bypasses rule 2 entirely. A signed-out → signed-in transition is
 *      the single clearest "I just came back" signal there is, and it is exactly the
 *      moment the prompt exists for, so it is never suppressed by a timer.
 *
 * And it stops asking for good only once the user has opened *every* configured
 * platform — tracked per platform, so opening X still leaves Instagram worth
 * mentioning. Tiles already opened keep their place with a check on them rather than
 * disappearing, because a grid that silently loses a tile between showings reads as
 * a bug, and re-asking for something already done reads as not paying attention.
 *
 * Two rules survive from the original and are not negotiable: the ~4.5s delay, so
 * somebody who opened the app to read one message gets to read it first, and the
 * route gate — this must never land on the marketing page, an auth screen, a chat,
 * or the public anonymous-send page, where the visitor is a stranger doing someone
 * else a favour and being sold to would be a bad first impression.
 *
 * If `lib/socialLinks.ts` has no real URLs in it, this renders nothing at all: a
 * follow prompt with dead tiles is worse than no prompt.
 */

/**
 * Bumping this retires every flag the previous cadence wrote.
 *
 * Not housekeeping — required. A device that had already recorded the old permanent
 * "followed" opt-out would stay silent forever under the new rules, so the very bug
 * being fixed would persist on exactly the devices that hit it. New names mean the
 * old values are simply never read again.
 */
const STORAGE_VERSION = "v2";

/** Epoch ms of the last showing. Enforces the 30-minute floor. */
const LAST_SHOWN_KEY = `whisper-social-prompt-${STORAGE_VERSION}`;
/** Comma-separated platforms the user has opened from here. */
const OPENED_KEY = `whisper-social-opened-${STORAGE_VERSION}`;

/** Long enough that the user has read whatever they opened the app for. */
const APPEAR_DELAY_MS = 4500;

/** Short on purpose — see rule 2. Reload spam is the only thing this stops. */
const COOLDOWN_MS = 30 * 60 * 1000;

/* Module state, not storage: it resets on a page load or app launch, which is the
   definition of "app open" we want, and it survives client-side navigation, which
   storage-based caps also do but only by paying for a write. */
let shownThisRuntime = false;
/* Set when a session goes away, so the next session can be recognised as a fresh
   sign-in rather than a token refresh (which fires the same subscription). */
let sawSignedOut = false;
/* One-shot permission to ignore the cooldown, granted by that sign-in. */
let skipCooldownOnce = false;

function readFlag(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    /* Private mode or storage disabled. Returning null is now safe: the real cap
       is `shownThisRuntime`, so the worst case is that a user in private mode sees
       this once per app open with no cooldown between — which is the intended
       behaviour anyway, just without the reload protection. */
    return null;
  }
}

function writeFlag(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* Nothing to do — see readFlag. */
  }
}

function readOpened(): Set<string> {
  const raw = readFlag(OPENED_KEY);
  return new Set(raw ? raw.split(",").filter(Boolean) : []);
}

export default function SocialFollowPrompt() {
  const pathname = usePathname();
  const reduced = useSafeReducedMotion();
  const [open, setOpen] = useState(false);
  /* Which platforms this device has already opened. Loaded in an effect rather
     than during render — reading storage while rendering would differ between the
     server and client passes and trip hydration. */
  const [opened, setOpened] = useState<Set<string>>(() => new Set());
  /* Incremented by a sign-in to re-run the arming effect below. */
  const [armToken, setArmToken] = useState(0);

  /* Computed once: the config is a module constant, so re-filtering it on every
     render would be pure waste on a component that mounts in the root layout. */
  const links = useMemo(() => activeSocialLinks(), []);

  /* Reuses the assistant's route list rather than keeping a second copy that can
     drift — the set of routes where a floating panel is unwelcome is the same set. */
  const routeAllowed = !assistantHiddenOn(pathname);

  /* Re-arm on a fresh sign-in. Subscribes to the shared session cache rather than
     opening a second `onAuthStateChange` listener, and distinguishes a real sign-in
     from a token refresh by requiring a signed-out state first — a refresh fires
     this same callback every hour and must not re-open the dialog. */
  useEffect(() => {
    return onSessionChange((session) => {
      if (!session) {
        sawSignedOut = true;
        return;
      }
      if (!sawSignedOut) return;
      sawSignedOut = false;
      shownThisRuntime = false;
      skipCooldownOnce = true;
      setArmToken((token) => token + 1);
    });
  }, []);

  useEffect(() => {
    /* No social links configured, or we're on a page where the prompt would be
       rude: the intro beat is over immediately, so the announcement popup that
       waits on it is free to appear. */
    if (links.length === 0 || !routeAllowed) {
      notifyIntroSettled();
      return;
    }
    if (shownThisRuntime) return;

    const alreadyOpened = readOpened();
    /* Hydrating client-only state (localStorage can't be read during the
       server pass) from an effect — the same external-system sync the hook is
       for. It settles before first paint of the dialog, which is delayed by the
       4.5s timer below. */
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOpened(alreadyOpened);
    /* Nothing left to ask for. Note this is per platform, so adding a new one to
       the config makes the prompt relevant again on its own. */
    if (links.every((link) => alreadyOpened.has(link.platform))) {
      notifyIntroSettled();
      return;
    }

    if (!skipCooldownOnce) {
      const last = Number(readFlag(LAST_SHOWN_KEY));
      if (Number.isFinite(last) && last > 0 && Date.now() - last < COOLDOWN_MS) {
        /* Within the reload cooldown: we won't show, so don't hold the
           announcement gate open either. */
        notifyIntroSettled();
        return;
      }
    }

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      /* Session check inside the timeout, not before it: `getCachedSession` may
         hit the network on a cold load, and doing it up front would race the
         delay we deliberately introduced. */
      const session = await getCachedSession();
      if (cancelled) return;
      if (!session) {
        notifyIntroSettled();
        return;
      }
      /* A second tab may have opened it during the delay, and the runtime flag is
         per document — the timestamp is the only thing both tabs can see. */
      if (!skipCooldownOnce) {
        const last = Number(readFlag(LAST_SHOWN_KEY));
        if (Number.isFinite(last) && last > 0 && Date.now() - last < COOLDOWN_MS) {
          notifyIntroSettled();
          return;
        }
      }

      shownThisRuntime = true;
      skipCooldownOnce = false;
      writeFlag(LAST_SHOWN_KEY, String(Date.now()));
      setOpen(true);
    }, APPEAR_DELAY_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
    /* Deliberately keyed on the route *category*, not `pathname`: re-running this
       on every navigation would restart the timer each time and mean a user who
       browses steadily never sits still long enough to see it. `armToken` is what
       lets a sign-in re-run it. */
  }, [links.length, routeAllowed, armToken]);

  /* Closing the social prompt (a follow tap or a dismiss) ends the intro beat,
     so the announcement queue can reveal itself next. */
  const close = useCallback(() => {
    setOpen(false);
    notifyIntroSettled();
  }, []);

  /* Tapping a tile records that platform and closes the dialog, so the user
     returns to a clean screen rather than to a prompt asking them to do the thing
     they just did. It is no longer a blanket opt-out — see the docblock. */
  const handleFollow = useCallback((link: SocialLink) => {
    setOpened((previous) => {
      const next = new Set(previous).add(link.platform);
      writeFlag(OPENED_KEY, Array.from(next).join(","));
      return next;
    });
    setOpen(false);
    notifyIntroSettled();
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
              const isOpened = opened.has(link.platform);
              return (
                <motion.button
                  key={link.platform}
                  type="button"
                  onClick={() => handleFollow(link)}
                  /* Says "opened", not "following": tapping a tile is all this
                     device can actually observe, and claiming a follow it cannot
                     verify would be a lie told in an accessibility label. */
                  aria-label={
                    isOpened
                      ? `Open Whisper on ${label} again — already opened`
                      : `Follow Whisper on ${label}`
                  }
                  className="group flex w-[4.5rem] flex-col items-center gap-2 rounded-2xl p-1.5 outline-none"
                  initial={reduced ? { opacity: 0 } : { opacity: 0, y: 10, scale: 0.9 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={
                    reduced ? tween.base : { ...spring.snappy, delay: 0.16 + i * 0.05 }
                  }
                  whileTap={reduced ? undefined : { scale: 0.93 }}
                >
                  <span
                    className="relative grid h-12 w-12 place-items-center rounded-2xl transition-transform duration-200 group-hover:-translate-y-0.5"
                    style={{
                      background: surface.bg,
                      color: surface.fg,
                      /* The rim is what stops X's and TikTok's pure black from
                         disappearing into a dark panel. */
                      boxShadow:
                        "0 6px 16px rgba(0,0,0,0.28), inset 0 0 0 1px rgba(255,255,255,0.16)",
                      opacity: isOpened ? 0.55 : 1,
                    }}
                  >
                    <SocialIcon platform={link.platform} size={22} />
                    {isOpened && (
                      <span
                        aria-hidden
                        className="absolute -bottom-1 -right-1 grid h-[1.1rem] w-[1.1rem] place-items-center rounded-full"
                        style={{
                          background: "var(--theme-success)",
                          color: "#04150d",
                          boxShadow: "0 2px 6px rgba(0,0,0,0.35)",
                        }}
                      >
                        <Check size={11} strokeWidth={3.2} />
                      </span>
                    )}
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
            One tap and we&apos;ll stop asking
          </p>
        </motion.div>
      </div>
    </Modal>
  );
}
