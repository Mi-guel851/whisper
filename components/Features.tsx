"use client";

import {
  motion,
  useMotionTemplate,
  useMotionValue,
  useSpring,
  useTransform,
} from "framer-motion";
import {
  MessageCircle,
  ImageIcon,
  Zap,
  Shield,
  Link2,
  BarChart3,
  type LucideIcon,
} from "lucide-react";
import { ease, revealOnScroll, staggerContainer, staggerItem, respectMotion } from "@/lib/motion";
import { useSafeReducedMotion } from "@/lib/useSafeReducedMotion";

const features = [
  { icon: MessageCircle, title: "Anonymous Messages", desc: "Receive honest, unfiltered messages from anyone — they'll never know it was them." },
  { icon: ImageIcon, title: "Anonymous Images", desc: "Let people send images alongside their messages, completely anonymously." },
  { icon: Zap, title: "Real-Time Inbox", desc: "Watch messages and views land live, no refresh needed — instant notifications." },
  { icon: Shield, title: "100% Anonymous", desc: "No sender identity is ever stored or shown. Not to you, not to anyone." },
  { icon: Link2, title: "One Shareable Link", desc: "Get your own Whisper link and drop it anywhere — bio, stories, DMs." },
  { icon: BarChart3, title: "Live Analytics", desc: "Track messages and views over time with your own activity chart." },
];

/** Spring config for the tilt. Loose enough to have momentum, tight enough not to wobble. */
const TILT_SPRING = { stiffness: 180, damping: 20, mass: 0.6 };

function FeatureCard({
  icon: Icon,
  title,
  desc,
}: {
  icon: LucideIcon;
  title: string;
  desc: string;
}) {
  const reduced = useSafeReducedMotion();

  // Normalised pointer position, -0.5 → 0.5 on each axis.
  const px = useMotionValue(0);
  const py = useMotionValue(0);

  // Springs rather than raw values: tying rotation directly to the cursor
  // feels mechanical because it has no momentum. The spring gives the card
  // weight, and lets it settle on mouse-leave instead of snapping back.
  const rotateX = useSpring(useTransform(py, [-0.5, 0.5], [10, -10]), TILT_SPRING);
  const rotateY = useSpring(useTransform(px, [-0.5, 0.5], [-10, 10]), TILT_SPRING);

  // Glow follows the pointer across the card face.
  const glowX = useTransform(px, (v) => `${(v + 0.5) * 100}%`);
  const glowY = useTransform(py, (v) => `${(v + 0.5) * 100}%`);
  const glowOpacity = useSpring(0, { stiffness: 200, damping: 30 });
  const glow = useMotionTemplate`radial-gradient(280px circle at ${glowX} ${glowY}, color-mix(in srgb, var(--theme-accent-purple) 22%, transparent), transparent 72%)`;

  function handleMove(event: React.MouseEvent<HTMLDivElement>) {
    if (reduced) return;
    const rect = event.currentTarget.getBoundingClientRect();
    px.set((event.clientX - rect.left) / rect.width - 0.5);
    py.set((event.clientY - rect.top) / rect.height - 0.5);
  }

  return (
    <motion.div
      variants={respectMotion(staggerItem, reduced)}
      onMouseMove={handleMove}
      onMouseEnter={() => !reduced && glowOpacity.set(1)}
      onMouseLeave={() => {
        px.set(0);
        py.set(0);
        glowOpacity.set(0);
      }}
      style={{
        perspective: 900,
      }}
      className="h-full"
    >
      <motion.div
        // `.feature-card` transitions box-shadow only. Deliberately NOT
        // .premium-card-interactive: that class declares `transition:
        // transform`, which would also apply to the inline transform Framer
        // writes here — every tilt frame would then be eased over 260ms and the
        // card would visibly lag the cursor.
        className="premium-card feature-card relative h-full overflow-hidden rounded-3xl p-8"
        style={{
          rotateX: reduced ? 0 : rotateX,
          rotateY: reduced ? 0 : rotateY,
          transformStyle: "preserve-3d",
        }}
      >
        {/* Pointer glow. Its own layer so it composites rather than forcing a
            repaint of the card's background on every pointer move. */}
        <motion.span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{ background: glow, opacity: glowOpacity }}
        />

        <div
          className="relative mb-5 inline-flex rounded-2xl p-3"
          style={{
            background: "color-mix(in srgb, var(--theme-accent-purple) 12%, transparent)",
            border: "1px solid color-mix(in srgb, var(--theme-accent-purple) 20%, transparent)",
          }}
        >
          <Icon size={26} style={{ color: "var(--theme-accent-purple)" }} />
        </div>

        <h3
          className="relative mb-2 text-xl font-bold"
          style={{ color: "var(--bridge-text)", letterSpacing: "var(--tracking-xl)" }}
        >
          {title}
        </h3>
        <p
          className="relative leading-7"
          style={{ color: "var(--bridge-text-secondary)" }}
        >
          {desc}
        </p>
      </motion.div>
    </motion.div>
  );
}

export default function Features() {
  const reduced = useSafeReducedMotion();

  return (
    <section
      id="features"
      className="relative mx-auto max-w-7xl px-4 py-16 sm:px-8 sm:py-24"
    >
      <motion.div
        className="mb-10 text-center sm:mb-16"
        initial={reduced ? { opacity: 0 } : { opacity: 0, y: 24 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.5 }}
        transition={{ duration: reduced ? 0.2 : 0.6, ease: ease.outExpo }}
      >
        <h2
          className="marketing-title"
          style={{ color: "var(--bridge-text)" }}
        >
          Everything you need,
          <span className="theme-accent-text block">nothing you don&apos;t.</span>
        </h2>
      </motion.div>

      <motion.div
        className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3"
        variants={respectMotion(staggerContainer(0.06), reduced)}
        {...revealOnScroll}
      >
        {features.map((feature) => (
          <FeatureCard key={feature.title} {...feature} />
        ))}
      </motion.div>
    </section>
  );
}
