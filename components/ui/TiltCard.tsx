"use client";

import { useRef } from "react";
import { motion, useMotionValue, useSpring, useTransform } from "framer-motion";
import useSafeReducedMotion from "@/lib/useSafeReducedMotion";

/**
 * Pointer-tracked 3D tilt.
 *
 * React equivalent of the sv-animations `tilt-card`. The card rotates toward the
 * cursor, so it reads as a physical panel catching the light rather than a
 * rectangle that changes colour on hover.
 *
 * Three decisions that matter more than the maths:
 *
 * 1. **Springs, not transitions.** The rotation is driven through `useSpring`, so
 *    when the pointer changes direction mid-motion the card redirects from where
 *    it actually is instead of restarting. A CSS transition would have to finish
 *    its current leg first, which is what makes most tilt effects feel like
 *    rubber rather than glass.
 *
 * 2. **Mouse only.** On touch there is no hover state, and tracking `pointermove`
 *    from a finger means every scroll that begins on a card tips it. Touch gets a
 *    press-scale instead — the feedback a finger actually expects.
 *
 * 3. **Transform and opacity only**, so the whole effect stays on the compositor.
 *    The glare is a pre-positioned radial gradient whose *opacity* animates; its
 *    position is written to a CSS variable, which does not trigger layout.
 */

type TiltCardProps = {
  children: React.ReactNode;
  /** Peak rotation at the corners. Past ~10 it stops reading as light and
   *  starts reading as a broken layout. */
  maxDegrees?: number;
  /** Lift toward the viewer on hover. 1 disables it. */
  hoverScale?: number;
  /** The moving specular highlight. */
  glare?: boolean;
  className?: string;
  /** Inline-flex for buttons, block for panels. */
  inline?: boolean;
};

export default function TiltCard({
  children,
  maxDegrees = 7,
  hoverScale = 1.02,
  glare = true,
  className = "",
  inline = false,
}: TiltCardProps) {
  const reduced = useSafeReducedMotion();
  const hostRef = useRef<HTMLDivElement | null>(null);

  /* Normalised pointer offset from centre, -0.5 to 0.5. */
  const px = useMotionValue(0);
  const py = useMotionValue(0);
  const lift = useMotionValue(1);

  /* Near-critically damped: it arrives quickly and does not wobble. Overshoot
     belongs on motion the user threw, not on motion that tracks them 1:1. */
  const config = { stiffness: 320, damping: 28, mass: 0.6 };
  const sx = useSpring(px, config);
  const sy = useSpring(py, config);
  const sScale = useSpring(lift, config);

  const rotateY = useTransform(sx, (v) => v * maxDegrees * 2);
  const rotateX = useTransform(sy, (v) => -v * maxDegrees * 2);

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    // See note 2: fingers scroll, they don't hover.
    if (reduced || event.pointerType !== "mouse") return;
    const host = hostRef.current;
    if (!host) return;

    const box = host.getBoundingClientRect();
    const nx = (event.clientX - box.left) / box.width - 0.5;
    const ny = (event.clientY - box.top) / box.height - 0.5;
    px.set(nx);
    py.set(ny);
    lift.set(hoverScale);

    if (glare) {
      /* Percentages, written straight to the custom property. The gradient is
         already painted; only its centre moves. */
      host.style.setProperty("--tilt-glare-x", `${(nx + 0.5) * 100}%`);
      host.style.setProperty("--tilt-glare-y", `${(ny + 0.5) * 100}%`);
      host.style.setProperty("--tilt-glare-opacity", "1");
    }
  }

  function reset() {
    px.set(0);
    py.set(0);
    lift.set(1);
    hostRef.current?.style.setProperty("--tilt-glare-opacity", "0");
  }

  /* Touch keeps the feedback it expects: a press, not a tip. */
  function handleTouchPress(pressed: boolean) {
    if (reduced) return;
    lift.set(pressed ? 0.97 : 1);
  }

  if (reduced) {
    return <div className={className}>{children}</div>;
  }

  return (
    <div
      ref={hostRef}
      className={`tilt-host ${inline ? "tilt-host-inline" : ""} ${className}`}
      onPointerMove={handlePointerMove}
      onPointerLeave={reset}
      onPointerCancel={reset}
      onPointerDown={(e) => e.pointerType !== "mouse" && handleTouchPress(true)}
      onPointerUp={() => handleTouchPress(false)}
    >
      <motion.div
        className="tilt-inner"
        style={{ rotateX, rotateY, scale: sScale }}
      >
        {children}
        {glare && <span className="tilt-glare" aria-hidden />}
      </motion.div>
    </div>
  );
}
