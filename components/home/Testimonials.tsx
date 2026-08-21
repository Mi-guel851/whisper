"use client";

import { Star } from "lucide-react";
import SectionHeading from "./SectionHeading";
import Avatar from "./Avatar";
import Reveal from "./Reveal";
import Marquee from "../ui/Marquee";

/**
 * Testimonial wall.
 *
 * Two marquee rows travelling in opposite directions. The counter-motion is the
 * point: a single rail sliding one way reads as a banner, while two rows moving
 * against each other read as a wall of people talking, and the eye settles on
 * individual cards instead of tracking the whole strip.
 *
 * This replaced a hand-scrolled snap rail with arrow buttons. The arrows went
 * with it — they existed only to push that rail, and there is nothing to push
 * once the row moves on its own. What they were for is still covered: the rows
 * pause under the pointer so a quote can be read, and `Marquee` falls back to a
 * real scroll rail when motion is reduced.
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

/* Split rather than duplicated, so the two rows never show the same quote side
   by side as they pass each other. */
const ROW_ONE = TESTIMONIALS.slice(0, 3);
const ROW_TWO = TESTIMONIALS.slice(3);

function TestimonialCard({ item }: { item: Testimonial }) {
  return (
    <figure className="premium-card flex w-[78vw] flex-col rounded-2xl p-6 sm:w-[20rem]">
      <div className="mb-4 flex items-center gap-3">
        <Avatar seed={item.handle} size={42} ring={false} />
        <div className="min-w-0">
          <figcaption
            className="truncate text-sm font-bold"
            style={{ color: "var(--bridge-text)" }}
          >
            {item.handle}
          </figcaption>
          <div className="mt-0.5 flex gap-0.5" aria-label="Rated 5 out of 5" role="img">
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
  );
}

export default function Testimonials() {
  return (
    <section className="relative mx-auto max-w-7xl px-4 py-16 sm:px-8 sm:py-24">
      <SectionHeading
        eyebrow="Loved by senders and receivers"
        title="What people are"
        accent="actually saying."
      />

      <Reveal amount={0.2}>
        {/* Space for the cards' own hover lift, which would otherwise be clipped
            by the marquee's overflow. */}
        <div className="space-y-4 py-1">
          <Marquee
            durationSeconds={46}
            itemsLabel="Testimonials, first row"
            className="py-1"
          >
            {ROW_ONE.map((item) => (
              <TestimonialCard key={item.handle} item={item} />
            ))}
          </Marquee>

          {/* Slower and reversed: matching speeds in opposite directions makes the
              pair look mechanical, and the offset keeps the rows from lining up. */}
          <Marquee
            reverse
            durationSeconds={54}
            itemsLabel="Testimonials, second row"
            className="py-1"
          >
            {ROW_TWO.map((item) => (
              <TestimonialCard key={item.handle} item={item} />
            ))}
          </Marquee>
        </div>
      </Reveal>
    </section>
  );
}
