"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Send } from "lucide-react";

import useSafeReducedMotion from "@/lib/useSafeReducedMotion";

/**
 * The successful-send celebration.
 *
 * A paper plane leaves the send button, arcs across the surface, and comes back.
 * Small feature, several traps:
 *
 *  - **It fires on success, not on click.** Celebrating a click that then fails
 *    is worse than no animation, so this is driven by a `flightId` the caller
 *    increments only after the write resolves. There is no `onClick` in here.
 *  - **It never blocks the send.** The plane is `position: fixed`,
 *    `pointer-events: none`, and rendered outside the form's own tree, so it
 *    cannot intercept a tap or delay a submit. The database call has already
 *    finished by the time it starts.
 *  - **It is interruptible.** A second successful send during a flight restarts
 *    cleanly via the `key`, rather than queueing or double-rendering.
 *  - **5 seconds is a long time for an animation.** On desktop it reads as
 *    playful; on a phone, where the plane crosses a much smaller area, the same
 *    duration reads as something stuck on screen. So mobile gets the same
 *    choreography at roughly half the duration — the concept is preserved, the
 *    loitering is not.
 *  - **Reduced motion gets a fade, not a flight.** No travel, no rotation.
 *
 * Usage: keep a counter in the sending component and bump it on success.
 *
 *   const [flightId, setFlightId] = useState(0);
 *   // ...after the insert resolves without error:
 *   setFlightId((n) => n + 1);
 *   <PaperPlaneFlight flightId={flightId} originRef={buttonRef} />
 *
 * If the send button is swapped for a success state — which is the common case —
 * measure it in your handler first and pass `origin` instead of `originRef`; see
 * the note on that prop for why a ref cannot work there.
 */

type Origin = { x: number; y: number };

type PaperPlaneFlightProps = {
  /** Increment to launch. `0` means "never sent yet" and animates nothing. */
  flightId: number;
  /** The send button, so the plane departs from and returns to the real icon. */
  originRef?: React.RefObject<HTMLElement | null>;
  /**
   * Explicit launch point in viewport coordinates, which wins over `originRef`.
   *
   * Needed whenever the send button is replaced by a success state, because both
   * updates land in the same React batch: by the time this effect runs the button
   * is already detached, and `getBoundingClientRect()` on a detached node returns
   * all zeros — the plane would launch from the top-left corner of the screen.
   * So a caller in that situation measures the button inside its own handler,
   * while it is still on screen, and passes the point in here.
   */
  origin?: Origin | null;
};

/** Desktop duration, in seconds. The spec's 5s, which suits a wide viewport. */
const FULL_DURATION = 5;

/** Phone duration. Same path, less loitering — see the note above. */
const COMPACT_DURATION = 2.6;

/** Viewport width under which the compact timing is used. */
const COMPACT_MAX_WIDTH = 640;

export default function PaperPlaneFlight({
  flightId,
  originRef,
  origin: originProp,
}: PaperPlaneFlightProps) {
  const reduced = useSafeReducedMotion();
  const [origin, setOrigin] = useState<Origin | null>(null);
  const [compact, setCompact] = useState(false);
  const clearTimer = useRef<number | null>(null);

  useEffect(() => {
    if (flightId <= 0) return;

    /* A point measured by the caller wins: it was taken while the button was
       still on screen, which a ref read here can no longer guarantee. */
    if (originProp) {
      setOrigin(originProp);
    } else {
      const node = originRef?.current;
      if (!node) return;

      /* Measured at launch, not on mount. The button moves — the composer grows as
         text wraps, the keyboard opens, the page scrolls — so a position captured
         earlier would send the plane off from where the button used to be. */
      const box = node.getBoundingClientRect();
      setOrigin({ x: box.left + box.width / 2, y: box.top + box.height / 2 });
    }

    setCompact(window.innerWidth < COMPACT_MAX_WIDTH);

    const seconds = reduced ? 0.5 : window.innerWidth < COMPACT_MAX_WIDTH ? COMPACT_DURATION : FULL_DURATION;

    /* Unmount after the flight so there is no fixed-position element sitting in
       the tree between sends. Cleared on re-launch and on unmount. */
    if (clearTimer.current !== null) window.clearTimeout(clearTimer.current);
    clearTimer.current = window.setTimeout(() => {
      clearTimer.current = null;
      setOrigin(null);
    }, seconds * 1000 + 120);

    return () => {
      if (clearTimer.current !== null) {
        window.clearTimeout(clearTimer.current);
        clearTimer.current = null;
      }
    };
  }, [flightId, originRef, originProp, reduced]);

  if (!origin) return null;

  const duration = compact ? COMPACT_DURATION : FULL_DURATION;

  /* The arc. Up and out to the left, a wide loop, then home.
     `x`/`y` are offsets from the origin so the same keyframes work wherever the
     button happens to be, and the last frame is 0/0 — the plane returns to the
     icon rather than vanishing mid-air, which is what makes it read as "sent and
     came back" instead of "an element disappeared". */
  const drift = compact ? 0.55 : 1;
  const xs = [0, -60 * drift, -150 * drift, -90 * drift, 40 * drift, 0];
  const ys = [0, -70 * drift, -150 * drift, -230 * drift, -140 * drift, 0];
  const rotates = [0, -18, -34, -8, 16, 0];
  const scales = [1, 1.16, 1.24, 1.1, 0.96, 1];

  return (
    <AnimatePresence>
      <motion.div
        key={flightId}
        aria-hidden
        className="pointer-events-none fixed z-[900]"
        style={{
          left: origin.x,
          top: origin.y,
          /* Centres the glyph on the measured point. */
          translateX: "-50%",
          translateY: "-50%",
        }}
        initial={{ opacity: 0 }}
        animate={
          reduced
            ? { opacity: [0, 1, 0] }
            : { opacity: [0, 1, 1, 1, 1, 0], x: xs, y: ys, rotate: rotates, scale: scales }
        }
        exit={{ opacity: 0 }}
        transition={
          reduced
            ? { duration: 0.5, times: [0, 0.3, 1] }
            : {
                duration,
                /* Front-loaded: the launch is quick and the return is slow, which
                   is how a thrown thing actually behaves. An even distribution
                   makes the whole path look like it is on rails. */
                times: [0, 0.12, 0.34, 0.6, 0.84, 1],
                ease: "easeInOut",
              }
        }
      >
        <span
          className="flex h-9 w-9 items-center justify-center rounded-full text-white"
          style={{
            background: "linear-gradient(135deg, #22d3ee, #8b5cf6 55%, #ec4899)",
            /* A real glow rather than a shadow, so it reads as lit from inside —
               and no backdrop-filter, which would cost a compositing layer on a
               moving element for an effect nobody can see at this size. */
            boxShadow: "0 6px 22px rgba(139,92,246,0.45)",
          }}
        >
          <Send size={16} />
        </span>
      </motion.div>
    </AnimatePresence>
  );
}
