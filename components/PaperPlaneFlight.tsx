"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Send } from "lucide-react";

import useSafeReducedMotion from "@/lib/useSafeReducedMotion";

/**
 * The successful-send celebration.
 *
 * A paper plane leaves the send button, flies out to the edge of the screen, and
 * comes back. Small feature, several traps:
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
 *  - **The path is measured, not hardcoded.** It used to be a ~150px hover near
 *    the button, which at a five-second duration read as loitering rather than
 *    flying. Now the far point is derived from where the button actually is and
 *    how much room the viewport gives it, so the plane genuinely crosses the
 *    screen — on a phone and on a desktop alike, and wherever the composer has
 *    ended up as text wrapped or the keyboard opened.
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

/** Everything the arc needs, all of it measured at launch. */
type Flight = {
  origin: Origin;
  /** Signed offset from the origin to the far point, in px. */
  lateral: number;
  vertical: number;
  duration: number;
};

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

/**
 * Desktop duration, in seconds.
 *
 * Unchanged from the spec's 5s, but it now covers several times the distance —
 * which is the actual fix for the old version feeling slow. Same clock, real
 * travel.
 */
const FULL_DURATION = 5;

/** Phone duration. The path is shorter, so the flight is too. */
const COMPACT_DURATION = 3.2;

/** Viewport width under which the compact timing is used. */
const COMPACT_MAX_WIDTH = 640;

/**
 * How close to the edge the far point sits.
 *
 * The glyph is 36px across and positioned by its centre, so 44px keeps it fully
 * on screen with a little air. Flying to a hard 0 would clip it and read as a
 * rendering bug rather than as reaching the edge.
 */
const EDGE_MARGIN = 44;

/**
 * Signed distance from `position` to whichever edge of a `extent`-long axis has
 * more room.
 *
 * Picking the roomier side is what makes one set of keyframes work for a button
 * anywhere on screen: the chat composer sits bottom-right so the plane goes up
 * and left, but a control near the left rail flies right instead of trying to
 * travel through the edge it is already touching.
 */
function reachOn(position: number, extent: number) {
  const towardStart = Math.max(position - EDGE_MARGIN, 0);
  const towardEnd = Math.max(extent - EDGE_MARGIN - position, 0);
  return towardStart >= towardEnd ? -towardStart : towardEnd;
}

/* The arc, as fractions of the measured reach.
   `x`/`y` are offsets from the origin so the same shape works wherever the
   button happens to be, and the last frame is 0/0 — the plane returns to the
   icon rather than vanishing mid-air, which is what makes it read as "sent and
   came back" instead of "an element disappeared".

   The vertical reach peaks at a full 1 and the lateral at 0.74, so the plane
   arrives at *one* edge on a curve rather than dashing diagonally into a corner.
   The horizontal drift also turns back before the vertical does, which is what
   gives the top of the path its bank. */
const X_PATH = [0, 0.10, 0.46, 0.70, 0.74, 0.62, 0.30, 0.07, 0];
const Y_PATH = [0, 0.15, 0.53, 0.85, 0.98, 1.0, 0.78, 0.26, 0];
const ROTATES = [0, -22, -34, -30, -14, 8, 30, 16, 0];
const SCALES = [1, 1.18, 1.22, 1.12, 1.04, 0.98, 0.93, 0.96, 1];
/* Front-loaded, and it lingers at the far point: the launch is quick, the turn
   is the slowest part of the path, and the return accelerates home. An even
   distribution makes the whole thing look like it is on rails. */
const TIMES = [0, 0.08, 0.24, 0.4, 0.5, 0.58, 0.74, 0.9, 1];
const OPACITIES = [0, 1, 1, 1, 1, 1, 1, 1, 0];

export default function PaperPlaneFlight({
  flightId,
  originRef,
  origin: originProp,
}: PaperPlaneFlightProps) {
  const reduced = useSafeReducedMotion();
  const [flight, setFlight] = useState<Flight | null>(null);
  const clearTimer = useRef<number | null>(null);

  useEffect(() => {
    if (flightId <= 0) return;

    let origin: Origin;

    /* A point measured by the caller wins: it was taken while the button was
       still on screen, which a ref read here can no longer guarantee. */
    if (originProp) {
      origin = originProp;
    } else {
      const node = originRef?.current;
      if (!node) return;

      /* Measured at launch, not on mount. The button moves — the composer grows as
         text wraps, the keyboard opens, the page scrolls — so a position captured
         earlier would send the plane off from where the button used to be. */
      const box = node.getBoundingClientRect();
      origin = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    }

    /* `innerWidth`/`innerHeight` rather than the document: the plane is fixed, so
       it flies to the edge of the *visible* area. On a phone with the keyboard up
       that is the shrunken viewport, which is exactly where the edge appears to
       be from the user's side. */
    const compact = window.innerWidth < COMPACT_MAX_WIDTH;
    const duration = compact ? COMPACT_DURATION : FULL_DURATION;

    setFlight({
      origin,
      lateral: reachOn(origin.x, window.innerWidth),
      vertical: reachOn(origin.y, window.innerHeight),
      duration,
    });

    const seconds = reduced ? 0.5 : duration;

    /* Unmount after the flight so there is no fixed-position element sitting in
       the tree between sends. Cleared on re-launch and on unmount. */
    if (clearTimer.current !== null) window.clearTimeout(clearTimer.current);
    clearTimer.current = window.setTimeout(() => {
      clearTimer.current = null;
      setFlight(null);
    }, seconds * 1000 + 120);

    return () => {
      if (clearTimer.current !== null) {
        window.clearTimeout(clearTimer.current);
        clearTimer.current = null;
      }
    };
  }, [flightId, originRef, originProp, reduced]);

  if (!flight) return null;

  const { origin, lateral, vertical, duration } = flight;

  const xs = X_PATH.map((fraction) => fraction * lateral);
  const ys = Y_PATH.map((fraction) => fraction * vertical);

  /* Bank into the turn. The tuned values assume the common case — a send button
     at the bottom right, so the plane climbs to the left — and mirror when it
     flies the other way, otherwise the nose would lean out of its own arc. */
  const bank = lateral <= 0 ? 1 : -1;
  const rotates = ROTATES.map((degrees) => degrees * bank);

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
          /* Promoted for the whole flight. It crosses most of the screen, and a
             mid-path layer promotion is a visible hitch. */
          willChange: "transform, opacity",
        }}
        initial={{ opacity: 0 }}
        animate={
          reduced
            ? { opacity: [0, 1, 0] }
            : { opacity: OPACITIES, x: xs, y: ys, rotate: rotates, scale: SCALES }
        }
        exit={{ opacity: 0 }}
        transition={
          reduced
            ? { duration: 0.5, times: [0, 0.3, 1] }
            : { duration, times: TIMES, ease: "easeInOut" }
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
