"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Star } from "lucide-react";
import SectionHeading from "./SectionHeading";
import Avatar from "./Avatar";
import Reveal from "./Reveal";

/**
 * Testimonial rail.
 *
 * Native overflow scrolling with CSS scroll-snap, not a JS carousel. That
 * choice buys the whole feature set for free: momentum and rubber-banding on
 * touch, two-finger trackpad swipes, keyboard scrolling, and correct behaviour
 * when the viewport resizes mid-interaction. A transform-based track would have
 * to reimplement every one of those, and would still fight the browser's own
 * gesture handling on iOS.
 *
 * The arrows drive `scrollBy` on the same element, so button navigation and
 * gesture navigation land on identical positions instead of drifting apart.
 */

type Testimonial = {
  handle: string;
  quote: string;
};

const TESTIMONIALS: readonly Testimonial[] = [
  { handle: "@its_joycee", quote: "This is better than NGL, genuinely. The replies actually feel real." },
  { handle: "@real_kayz", quote: "My inbox exploded the day I posted my link. Still going." },
  { handle: "@mimi.vibes", quote: "The animations are insane. It feels like a proper app, not a web page." },
  { handle: "@steve.0x", quote: "Finally, 100% anonymous. No sign-up nonsense for the people replying." },
  { handle: "@dami_writes", quote: "Voice notes changed it for me. Hearing something anonymous hits different." },
  { handle: "@toluwa.a", quote: "Set it up in under a minute and had messages before I closed the tab." },
];

export default function Testimonials() {
  const railRef = useRef<HTMLDivElement>(null);
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(false);

  /**
   * Recomputes which arrows are still useful.
   *
   * The 1px tolerance is not superstition: fractional device pixel ratios make
   * `scrollLeft + clientWidth` land a hair short of `scrollWidth` at the true
   * end, so an exact comparison leaves the "next" arrow permanently enabled on
   * most laptops.
   */
  const syncArrows = useCallback(() => {
    const rail = railRef.current;
    if (!rail) return;
    setAtStart(rail.scrollLeft <= 1);
    setAtEnd(rail.scrollLeft + rail.clientWidth >= rail.scrollWidth - 1);
  }, []);

  useEffect(() => {
    syncArrows();
    const rail = railRef.current;
    if (!rail) return;

    // Also on resize: a window that widens can reveal the last card and leave
    // the "next" arrow enabled with nowhere left to scroll.
    const observer = new ResizeObserver(syncArrows);
    observer.observe(rail);

    return () => observer.disconnect();
  }, [syncArrows]);

  const step = useCallback((direction: 1 | -1) => {
    const rail = railRef.current;
    if (!rail) return;

    // Measure the real card rather than assuming a width — the cards are
    // percentage-sized and change with the breakpoint.
    const card = rail.firstElementChild as HTMLElement | null;
    const gap = 16;
    const distance = card ? card.offsetWidth + gap : rail.clientWidth * 0.8;
    rail.scrollBy({ left: direction * distance, behavior: "smooth" });
  }, []);

  return (
    <section className="relative mx-auto max-w-7xl px-4 py-16 sm:px-8 sm:py-24">
      <SectionHeading
        eyebrow="Loved by senders and receivers"
        title="What people are"
        accent="actually saying."
      />

      <Reveal amount={0.2}>
        <div className="relative">
          <div
            ref={railRef}
            onScroll={syncArrows}
            className="snap-rail gap-4 pb-2"
            // A scrollable region needs to be focusable and named, or keyboard
            // users can reach the cards but never scroll to them.
            tabIndex={0}
            role="group"
            aria-label="Testimonials, scrollable"
          >
            {TESTIMONIALS.map((item) => (
              <figure
                key={item.handle}
                className="premium-card flex w-[78vw] flex-col rounded-2xl p-6 sm:w-[20rem]"
              >
                <div className="mb-4 flex items-center gap-3">
                  <Avatar seed={item.handle} size={42} ring={false} />
                  <div className="min-w-0">
                    <figcaption
                      className="truncate text-sm font-bold"
                      style={{ color: "var(--bridge-text)" }}
                    >
                      {item.handle}
                    </figcaption>
                    <div
                      className="mt-0.5 flex gap-0.5"
                      aria-label="Rated 5 out of 5"
                      role="img"
                    >
                      {Array.from({ length: 5 }, (_, index) => (
                        <Star
                          key={index}
                          size={11}
                          fill="currentColor"
                          style={{ color: "var(--theme-warning)" }}
                        />
                      ))}
                    </div>
                  </div>
                </div>

                <blockquote
                  className="text-[0.9375rem] leading-6"
                  style={{ color: "var(--bridge-text-secondary)" }}
                >
                  &ldquo;{item.quote}&rdquo;
                </blockquote>
              </figure>
            ))}
          </div>

          {/* Arrows sit outside the rail's scroll box so they never scroll away
              with the content. Hidden on touch, where the swipe is the control
              and a pair of buttons is just chrome in the way. */}
          <div className="mt-6 hidden justify-end gap-2 sm:flex">
            <button
              type="button"
              onClick={() => step(-1)}
              disabled={atStart}
              aria-label="Previous testimonials"
              className="glass-control grid h-10 w-10 place-items-center rounded-full transition-opacity disabled:pointer-events-none disabled:opacity-35"
              style={{ color: "var(--bridge-text)" }}
            >
              <ChevronLeft size={18} />
            </button>
            <button
              type="button"
              onClick={() => step(1)}
              disabled={atEnd}
              aria-label="Next testimonials"
              className="glass-control grid h-10 w-10 place-items-center rounded-full transition-opacity disabled:pointer-events-none disabled:opacity-35"
              style={{ color: "var(--bridge-text)" }}
            >
              <ChevronRight size={18} />
            </button>
          </div>
        </div>
      </Reveal>
    </section>
  );
}
