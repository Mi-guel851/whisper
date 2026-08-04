"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { duration, ease } from "@/lib/motion";
import { useSafeReducedMotion } from "@/lib/useSafeReducedMotion";

/**
 * True once the app has painted at least one route. Lives at module scope
 * because `app/template.tsx` mounts a *new* instance of this component on every
 * navigation — a ref would reset each time and could never tell "cold start"
 * apart from "navigated here".
 */
let hasBooted = false;

/**
 * Route-level transition.
 *
 * Deliberately opacity-only. A translate or blur on this wrapper would make it
 * a *containing block* for every `position: fixed` descendant — which in this
 * app means BottomNavigation, Navbar, the chat header and the chat composer
 * would all detach from the viewport and ride the animation. Opacity creates a
 * stacking context but not a containing block, so fixed children stay pinned.
 *
 * There is no exit animation: template.tsx has already discarded the outgoing
 * tree by the time this renders. Faking one with AnimatePresence here would
 * only overlap two routes for a few frames. Departure is communicated by the
 * top progress bar in the root layout instead, so this only handles arrival.
 *
 * The very first paint is not animated — the browser is already fading in from
 * blank, and a second fade on top of it reads as a flash.
 */
export default function TemplateTransition({
  children,
}: {
  children: React.ReactNode;
}) {
  const reduced = useSafeReducedMotion();
  // Captured once per mount, before the effect below flips the module flag.
  const [isColdStart] = useState(() => !hasBooted);
  // Resolves to `false` during hydration and settles a frame later, so the
  // server and client agree on the initial markup. Gating on it directly is
  // fine because `initial` is only read at mount.
  const shouldAnimate = !isColdStart && !reduced;

  const [settled, setSettled] = useState(!shouldAnimate);
  const nodeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    hasBooted = true;
  }, []);

  return (
    <motion.div
      ref={nodeRef}
      initial={shouldAnimate ? { opacity: 0 } : false}
      animate={{ opacity: 1 }}
      transition={{ duration: duration.base, ease: ease.outQuint }}
      onAnimationComplete={() => setSettled(true)}
      // Dropped once the fade lands: a permanent compositing hint keeps the
      // subtree on its own layer and can leave text rendering off the
      // subpixel path.
      style={{ willChange: settled ? undefined : "opacity" }}
    >
      {children}
    </motion.div>
  );
}
