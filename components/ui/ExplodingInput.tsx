"use client";

import { useEffect, useRef } from "react";
import useSafeReducedMotion from "@/lib/useSafeReducedMotion";

/**
 * Sparks that burst from the caret as you type.
 *
 * React equivalent of the sv-animations `exploding-input`, rebuilt for the two
 * places it runs in this app: the chat composer and the anonymous-message box on
 * someone's link page. Both are the highest-frequency inputs in Whisper, so the
 * implementation is built around one constraint — **typing must not re-render
 * React.**
 *
 * How it stays free:
 *
 * * **A fixed pool of DOM nodes, reused round-robin.** No node is created or
 *   destroyed while someone types, and no state is set, so the component that owns
 *   the textarea never re-renders on a keystroke it wasn't already re-rendering for.
 * * **Web Animations API, not CSS class toggling.** Each spark's flight is handed
 *   to the compositor as a `transform`/`opacity` animation and forgotten. Nothing
 *   polls it and there is no timeout to clear.
 * * **Emission is throttled.** Fast typing produces a steady trickle, not a spark
 *   per character, which is both calmer to look at and bounded in cost.
 * * **One layout read per emission.** The caret's pixel position comes from a
 *   hidden mirror element that duplicates the field's text metrics — the only way
 *   to locate a caret inside a `textarea`. Reading it is a forced layout, so it
 *   happens at the throttled rate, never per keypress.
 *
 * Under reduced motion the field renders exactly as it would otherwise, minus the
 * sparks — the wrapper is still present so spacing is identical either way.
 */

type ExplodingInputProps = {
  /** The field driving the effect. Must be the same node the caller renders. */
  targetRef: React.RefObject<HTMLTextAreaElement | HTMLInputElement | null>;
  /** The field itself, plus whatever else shares its box. */
  children: React.ReactNode;
  /** Pool size. Larger looks denser under fast typing and costs more nodes. */
  poolSize?: number;
  /** Sparks released per emission. */
  perBurst?: number;
  /** Minimum ms between emissions. */
  throttleMs?: number;
  /** Spark colour. Defaults to Whisper's accent. */
  color?: string;
  className?: string;
};

/* Style properties the mirror has to match for its text to wrap and advance
   exactly like the real field's. Anything that affects glyph advance or line
   breaking belongs here. */
const MIRRORED_STYLES = [
  "boxSizing",
  "borderBottomWidth",
  "borderLeftWidth",
  "borderRightWidth",
  "borderTopWidth",
  "fontFamily",
  "fontSize",
  "fontStretch",
  "fontStyle",
  "fontVariant",
  "fontWeight",
  "letterSpacing",
  "lineHeight",
  "paddingBottom",
  "paddingLeft",
  "paddingRight",
  "paddingTop",
  "textAlign",
  "textIndent",
  "textTransform",
  "wordSpacing",
] as const;

export default function ExplodingInput({
  targetRef,
  children,
  poolSize = 18,
  perBurst = 2,
  throttleMs = 55,
  color = "var(--theme-accent-purple)",
  className = "",
}: ExplodingInputProps) {
  const reduced = useSafeReducedMotion();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const layerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    const layer = layerRef.current;
    const field = targetRef.current;
    if (reduced || !host || !layer || !field) return;

    /* ---- pool ---- */
    const pool: HTMLSpanElement[] = [];
    for (let i = 0; i < poolSize; i += 1) {
      const spark = document.createElement("span");
      spark.className = "explode-spark";
      spark.style.opacity = "0";
      layer.appendChild(spark);
      pool.push(spark);
    }
    let cursor = 0;

    /* ---- caret mirror ---- */
    const mirror = document.createElement("div");
    mirror.className = "explode-mirror";
    const marker = document.createElement("span");
    marker.textContent = "​";
    host.appendChild(mirror);

    let styled = false;
    function syncMirrorStyles() {
      const computed = window.getComputedStyle(field as HTMLElement);
      for (const prop of MIRRORED_STYLES) {
        mirror.style[prop] = computed[prop];
      }
      const multiline = field instanceof HTMLTextAreaElement;
      mirror.style.whiteSpace = multiline ? "pre-wrap" : "pre";
      mirror.style.overflowWrap = multiline ? "break-word" : "normal";
      mirror.style.width = `${(field as HTMLElement).clientWidth}px`;
      styled = true;
    }

    /** Caret position in the layer's coordinate space, or null if unavailable. */
    function caretPoint(): { x: number; y: number } | null {
      if (!styled) syncMirrorStyles();

      const value = (field as HTMLInputElement).value ?? "";
      const caret = (field as HTMLInputElement).selectionEnd ?? value.length;

      mirror.textContent = value.slice(0, caret);
      mirror.appendChild(marker);

      const fieldBox = (field as HTMLElement).getBoundingClientRect();
      const hostBox = host!.getBoundingClientRect();

      /* offsetTop/Left are relative to the mirror, which is pinned to the field's
         own top-left, so subtracting the field's scroll and adding its offset
         inside the host lands the point in layer space. */
      const x =
        marker.offsetLeft - (field as HTMLElement).scrollLeft + (fieldBox.left - hostBox.left);
      const y =
        marker.offsetTop - (field as HTMLElement).scrollTop + (fieldBox.top - hostBox.top);

      /* A caret scrolled out of the visible box would throw sparks over unrelated
         chrome, so nothing is emitted for it. */
      if (y < -8 || y > fieldBox.height + 8) return null;
      return { x, y };
    }

    /* ---- emission ---- */
    let last = 0;
    let previousLength = ((field as HTMLInputElement).value ?? "").length;

    function emit() {
      const point = caretPoint();
      if (!point) return;

      /* Half a line up, so the sparks look like they come off the text rather
         than out of the baseline. */
      const lineHeight = parseFloat(mirror.style.lineHeight) || 20;
      const originY = point.y + lineHeight * 0.45;

      for (let i = 0; i < perBurst; i += 1) {
        const spark = pool[cursor];
        cursor = (cursor + 1) % pool.length;

        /* A node still in flight is cancelled rather than allowed to stack — two
           overlapping animations on one element fight over the transform. */
        spark.getAnimations().forEach((animation) => animation.cancel());

        /* Deterministic-ish spread from the pool index: a fan rather than random
           scatter, which reads as intentional and avoids Math.random churn. */
        const angle = -Math.PI / 2 + ((i + cursor) % 7 - 3) * 0.34;
        const distance = 16 + ((cursor * 7) % 13);
        const size = 3 + ((cursor * 3) % 3);

        spark.style.left = `${point.x}px`;
        spark.style.top = `${originY}px`;
        spark.style.width = `${size}px`;
        spark.style.height = `${size}px`;
        spark.style.background = color;

        spark.animate(
          [
            { transform: "translate(-50%, -50%) scale(1)", opacity: 0.9 },
            {
              transform: `translate(calc(-50% + ${Math.cos(angle) * distance}px), calc(-50% + ${
                Math.sin(angle) * distance
              }px)) scale(0.2)`,
              opacity: 0,
            },
          ],
          {
            duration: 520 + ((cursor * 37) % 180),
            easing: "cubic-bezier(0.16, 1, 0.3, 1)",
            fill: "none",
          }
        );
      }
    }

    function handleInput() {
      const value = (field as HTMLInputElement).value ?? "";
      /* Only additions spark. Deleting is not a moment worth celebrating, and
         a paste of 400 characters gets one burst, not four hundred. */
      const grew = value.length > previousLength;
      previousLength = value.length;
      if (!grew) return;

      const now = performance.now();
      if (now - last < throttleMs) return;
      last = now;
      emit();
    }

    /* Width and font can change with the theme, an orientation change, or the
       composer growing as it wraps, so the mirror is re-measured lazily. */
    function invalidate() {
      styled = false;
    }

    field.addEventListener("input", handleInput);
    window.addEventListener("resize", invalidate, { passive: true });

    return () => {
      field.removeEventListener("input", handleInput);
      window.removeEventListener("resize", invalidate);
      pool.forEach((spark) => {
        spark.getAnimations().forEach((animation) => animation.cancel());
        spark.remove();
      });
      mirror.remove();
    };
  }, [reduced, targetRef, poolSize, perBurst, throttleMs, color]);

  return (
    <div ref={hostRef} className={`explode-host ${className}`}>
      {children}
      {!reduced && <div ref={layerRef} className="explode-layer" aria-hidden />}
    </div>
  );
}
