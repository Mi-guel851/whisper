"use client";

import { useEffect } from "react";
import useSafeReducedMotion from "@/lib/useSafeReducedMotion";

/**
 * Sparks off the caret, everywhere in the app.
 *
 * `components/ui/ExplodingInput` does this for one field at a time, by wrapping
 * it. That is the right shape for the two composers it was built for — the chat
 * box and the anonymous-message box, which want their own tuning — but the app
 * has thirty-one text fields across eighteen files, and wrapping each one means
 * thirty-one refs, thirty-one wrappers, and a layout risk per file for an effect
 * that is identical every time.
 *
 * So this is the delegated version: one `input` listener on `document`, one pool
 * of spark nodes, one caret mirror, mounted once in the root layout. Every field
 * that exists now gets it, and so does every field added later, with no wiring.
 * It follows `components/ClickHaptics`, which solves the same problem for taps.
 *
 * How it stays free:
 *
 * * **Nothing re-renders.** The component returns `null` and never sets state.
 *   The DOM it owns is created once, outside React, and animated by the Web
 *   Animations API — so typing costs no React work at all, in any field.
 * * **One pool, reused round-robin.** No node is created or destroyed while
 *   someone types.
 * * **Throttled emission.** Fast typing produces a trickle, not a spark per
 *   character. A person types into one field at a time, so one global throttle
 *   is enough.
 * * **One layout read per emission.** Locating a caret inside a `textarea` needs
 *   a hidden twin of the field, and measuring it forces layout — so it happens
 *   at the throttled rate, never per keypress.
 *
 * What is deliberately excluded, and why:
 *
 * * **Password and one-time-code fields.** Sparks mark the caret, which is a
 *   visible count of how many characters have been typed — a shoulder-surfing
 *   tell on exactly the fields where that matters. Secret entry is also not a
 *   moment that wants celebrating.
 * * **Fields with no meaningful caret** — checkbox, file, range, date, and
 *   `number` (whose selection API is not available on it in Chrome).
 * * **Anything already inside `.explode-host`.** Those are the two hand-tuned
 *   composers; double sparks would just look heavier there than everywhere else.
 * * **`data-no-sparks`** on a field or any ancestor, as the explicit opt-out.
 *
 * Under reduced motion nothing is attached and no DOM is created.
 */

/** Input types with a caret worth decorating. */
const SPARKABLE_TYPES = new Set([
  "",
  "text",
  "search",
  "email",
  "url",
  "tel",
]);

/** Pool size. Larger looks denser under fast typing and costs more nodes. */
const POOL_SIZE = 20;

/** Sparks released per emission. */
const PER_BURST = 2;

/** Minimum ms between emissions. */
const THROTTLE_MS = 55;

/** Above every modal and toast in the app; below the route loader at 2000. */
const LAYER_Z = 1300;

/* Style properties the mirror has to match for its text to wrap and advance
   exactly like the real field's. Anything that affects glyph advance or line
   breaking belongs here. Border widths are deliberately absent — the mirror runs
   without a border and the field's border is added to the caret point instead,
   which keeps the two boxes from disagreeing about where content starts. */
const MIRRORED_STYLES = [
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

type Field = HTMLInputElement | HTMLTextAreaElement;

function isSparkable(node: EventTarget | null): node is Field {
  if (node instanceof HTMLTextAreaElement) return allowed(node);
  if (node instanceof HTMLInputElement) {
    if (!SPARKABLE_TYPES.has(node.type)) return false;
    /* `autoComplete="one-time-code"` is how the PIN and verification fields are
       marked, whatever their `type` says. */
    if (node.autocomplete === "one-time-code") return false;
    return allowed(node);
  }
  return false;
}

function allowed(field: Field) {
  if (field.readOnly || field.disabled) return false;
  if (field.closest("[data-no-sparks]")) return false;
  // Already has its own, tuned, spark layer.
  if (field.closest(".explode-host")) return false;
  return true;
}

export default function TypingSparks() {
  const reduced = useSafeReducedMotion();

  useEffect(() => {
    if (reduced) return;
    if (typeof document === "undefined") return;
    /* WAAPI is the whole implementation — no CSS-class fallback, because a
       browser without it is also a browser this effect is not worth shimming
       for. Typing keeps working; it just does not sparkle. */
    if (typeof Element.prototype.animate !== "function") return;

    /* ---- spark layer ---- */
    const layer = document.createElement("div");
    layer.setAttribute("aria-hidden", "true");
    layer.style.cssText = `position:fixed;inset:0;pointer-events:none;overflow:hidden;z-index:${LAYER_Z};`;
    document.body.appendChild(layer);

    const pool: HTMLSpanElement[] = [];
    for (let index = 0; index < POOL_SIZE; index += 1) {
      const spark = document.createElement("span");
      spark.className = "typing-spark";
      layer.appendChild(spark);
      pool.push(spark);
    }
    let cursor = 0;

    /* ---- caret mirror ----
       One mirror, restyled whenever the field being typed into changes. Kept in
       the body rather than beside each field so it never inherits a container's
       transform or clipping.

       `fixed`, not `absolute`: a long message makes this twin as tall as the text
       it duplicates, and an absolute element that tall would extend the document
       and hand the page a scrollbar it should not have. A fixed element never
       contributes to scroll size, and — being positioned — is still the marker's
       `offsetParent`, which is the only thing the caret maths needs from it. */
    const mirror = document.createElement("div");
    mirror.setAttribute("aria-hidden", "true");
    mirror.style.cssText =
      "position:fixed;top:0;left:0;visibility:hidden;pointer-events:none;" +
      "border:0;box-sizing:content-box;overflow:hidden;z-index:-1;";
    document.body.appendChild(mirror);

    const marker = document.createElement("span");
    marker.textContent = "​";

    /** The field the mirror is currently styled for. */
    let styledFor: Field | null = null;
    /** Caret-relative border offset of that field, in px. */
    let borderLeft = 0;
    let borderTop = 0;

    function syncMirror(field: Field) {
      const computed = window.getComputedStyle(field);
      for (const property of MIRRORED_STYLES) {
        mirror.style[property] = computed[property];
      }

      const multiline = field instanceof HTMLTextAreaElement;
      mirror.style.whiteSpace = multiline ? "pre-wrap" : "pre";
      mirror.style.overflowWrap = multiline ? "break-word" : "normal";

      /* `clientWidth` is the padding box. The mirror is content-box with the
         same padding, so its content width is that minus the padding — which is
         exactly the width the real text wraps inside. Getting this wrong puts
         the caret on the wrong line of a wrapped textarea. */
      const padX =
        parseFloat(computed.paddingLeft || "0") + parseFloat(computed.paddingRight || "0");
      mirror.style.width = `${Math.max(field.clientWidth - padX, 0)}px`;

      borderLeft = parseFloat(computed.borderLeftWidth || "0");
      borderTop = parseFloat(computed.borderTopWidth || "0");
      styledFor = field;
    }

    /** Caret position in viewport coordinates, or null if it isn't visible. */
    function caretPoint(field: Field): { x: number; y: number; line: number } | null {
      if (styledFor !== field) syncMirror(field);

      const value = field.value ?? "";
      let caret = value.length;
      try {
        caret = field.selectionEnd ?? value.length;
      } catch {
        /* Some input types refuse the selection API. Fall back to the end of the
           value, which is where the caret is during ordinary typing anyway. */
      }

      mirror.textContent = value.slice(0, caret);
      mirror.appendChild(marker);

      const box = field.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) return null;

      const x = box.left + borderLeft + marker.offsetLeft - field.scrollLeft;
      const y = box.top + borderTop + marker.offsetTop - field.scrollTop;

      /* A caret scrolled out of the field's own visible box would throw sparks
         over unrelated chrome, so nothing is emitted for it. */
      if (y < box.top - 8 || y > box.bottom + 8) return null;
      if (x < box.left - 8 || x > box.right + 8) return null;

      return { x, y, line: parseFloat(mirror.style.lineHeight) || 20 };
    }

    /* ---- emission ---- */
    let last = 0;
    const lengths = new WeakMap<Field, number>();

    /* The accent as a live custom property rather than a resolved colour. The
       layer sits in `body`, so it inherits from `:root` and the sparks follow a
       theme switch with no invalidation step and no `getComputedStyle` per
       emission. */
    const SPARK_COLOR = "var(--theme-accent-purple, #8b5cf6)";

    function emit(field: Field) {
      const point = caretPoint(field);
      if (!point) return;

      /* Half a line down from the caret's top edge, so the sparks come off the
         middle of the text rather than out of its ascender. */
      const originY = point.y + point.line * 0.45;

      for (let index = 0; index < PER_BURST; index += 1) {
        const spark = pool[cursor];
        cursor = (cursor + 1) % pool.length;

        /* A node still in flight is cancelled rather than allowed to stack — two
           overlapping animations on one element fight over the transform. */
        spark.getAnimations().forEach((animation) => animation.cancel());

        /* Deterministic-ish spread from the pool index: a fan rather than random
           scatter, which reads as intentional and avoids Math.random churn. */
        const angle = -Math.PI / 2 + (((index + cursor) % 7) - 3) * 0.34;
        const distance = 16 + ((cursor * 7) % 13);
        const size = 3 + ((cursor * 3) % 3);

        spark.style.left = `${point.x}px`;
        spark.style.top = `${originY}px`;
        spark.style.width = `${size}px`;
        spark.style.height = `${size}px`;
        spark.style.background = SPARK_COLOR;

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

    function handleInput(event: Event) {
      const field = event.target;
      if (!isSparkable(field)) return;

      const length = (field.value ?? "").length;
      const previous = lengths.get(field) ?? 0;
      lengths.set(field, length);

      /* Only additions spark. Deleting is not a moment worth celebrating, and a
         paste of 400 characters gets one burst, not four hundred. */
      if (length <= previous) return;

      const now = performance.now();
      if (now - last < THROTTLE_MS) return;
      last = now;
      emit(field);
    }

    /* A field's own length is read on focus rather than assumed to be zero, so
       returning to a half-written message and continuing does not count the
       existing text as one enormous addition. */
    function handleFocusIn(event: FocusEvent) {
      const field = event.target;
      if (!isSparkable(field)) return;
      lengths.set(field, (field.value ?? "").length);
      if (styledFor === field) styledFor = null;
    }

    /* Width and font both change from under the mirror — an orientation change,
       a theme switch, a composer growing as it wraps. Dropping the cached styling
       makes the next emission re-measure. */
    function invalidate() {
      styledFor = null;
    }

    const listen = { capture: true, passive: true } as const;
    document.addEventListener("input", handleInput, listen);
    document.addEventListener("focusin", handleFocusIn, listen);
    window.addEventListener("resize", invalidate, { passive: true });

    return () => {
      document.removeEventListener("input", handleInput, { capture: true });
      document.removeEventListener("focusin", handleFocusIn, { capture: true });
      window.removeEventListener("resize", invalidate);
      pool.forEach((spark) => {
        spark.getAnimations().forEach((animation) => animation.cancel());
      });
      layer.remove();
      mirror.remove();
    };
  }, [reduced]);

  return null;
}
