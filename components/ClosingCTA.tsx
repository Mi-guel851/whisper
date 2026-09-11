"use client";

import Image from "next/image";
import { motion } from "framer-motion";
import { ArrowRight, Check } from "lucide-react";
import EdgeLitCard from "./EdgeLitCard";
import { ButtonLink } from "./Button";
import DownloadAndroidButton from "./DownloadAndroidButton";
import { respectMotion, staggerContainer, staggerItem } from "@/lib/motion";
import { useSafeReducedMotion } from "@/lib/useSafeReducedMotion";
import { useRouter } from "next/navigation";
import { Capacitor } from "@capacitor/core";
import { shouldShowPlatformChoice } from "@/lib/platformChoice";

/**
 * The closing CTA.
 *
 * Split rather than centred: the mascot on one side gives the eye somewhere to
 * land before the copy, and the copy column can then stay left-aligned, which
 * is where the three guarantees actually want to live — a centred list of
 * check marks has no shared left edge, so it reads as decoration rather than
 * as a list.
 */

const GUARANTEES = [
  "100% anonymous, always",
  "No signup for senders",
  "Free forever",
];

export default function ClosingCTA() {
  const reduced = useSafeReducedMotion();
  const router = useRouter();
  const handleCreate = (e: React.MouseEvent) => {
    e.preventDefault();
    let isNative = false;
    try { isNative = Capacitor.isNativePlatform(); } catch {}
    router.push(shouldShowPlatformChoice(isNative) ? "/choose-platform" : "/signup");
  };

  return (
    <section className="relative mx-auto max-w-6xl px-4 py-16 sm:px-8 sm:py-24">
      <motion.div
        variants={respectMotion(staggerContainer(0.08), reduced)}
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, amount: 0.3 }}
      >
        {/* The rim runs brighter here than in the sections above but slower
            than the hero — the eye should settle on this card, not be pulled
            back to the top of the page. */}
        <EdgeLitCard
          radius="3xl"
          intensity={0.55}
          speed={13}
          innerClassName="grid grid-cols-1 items-center gap-10 p-8 sm:p-12 lg:grid-cols-[auto_1fr] lg:gap-14 lg:p-16"
        >
          {/* --- Mascot --- */}
          <motion.div
            variants={respectMotion(staggerItem, reduced)}
            className="relative mx-auto w-fit lg:mx-0"
          >
            {/* A blurred ellipse under the ghost so it reads as lit from
                behind rather than pasted onto the card. */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute left-1/2 top-1/2 h-32 w-32 -translate-x-1/2 -translate-y-1/2 rounded-full"
              style={{
                background:
                  "radial-gradient(circle, color-mix(in srgb, var(--brand-cyan) 34%, transparent), transparent 68%)",
                filter: "blur(26px)",
              }}
            />
            {/* Drift, not `animate-pulse`. Pulsing opacity on a logo reads as a
                loading state; drifting reads as ambient. */}
            <motion.div
              className="relative"
              animate={reduced ? undefined : { y: [0, -9, 0] }}
              transition={{ duration: 4.6, repeat: Infinity, ease: "easeInOut" }}
            >
              <Image
                src="/ghost.png"
                alt=""
                width={124}
                height={124}
                className="h-[92px] w-[92px] sm:h-[124px] sm:w-[124px]"
              />
            </motion.div>
          </motion.div>

          {/* --- Copy --- */}
          <div className="text-center lg:text-left">
            <motion.h2
              variants={respectMotion(staggerItem, reduced)}
              className="marketing-title"
              style={{ color: "var(--bridge-text)" }}
            >
              Ready to hear what people{" "}
              <span className="theme-accent-text">really</span> think?
            </motion.h2>

            <motion.p
              variants={respectMotion(staggerItem, reduced)}
              className="mx-auto mt-4 max-w-xl text-base leading-7 sm:text-lg lg:mx-0"
              style={{ color: "var(--bridge-text-secondary)" }}
            >
              Create your Whisper link and start receiving honest, anonymous
              messages today.
            </motion.p>

            <motion.ul
              variants={respectMotion(staggerItem, reduced)}
              className="mt-7 flex flex-col items-center gap-3 sm:flex-row sm:flex-wrap sm:justify-center lg:justify-start"
            >
              {GUARANTEES.map((item) => (
                <li
                  key={item}
                  className="flex items-center gap-2 text-sm font-semibold"
                  style={{ color: "var(--bridge-text-secondary)" }}
                >
                  <span
                    className="grid h-5 w-5 shrink-0 place-items-center rounded-full"
                    style={{
                      color: "var(--theme-success)",
                      background:
                        "color-mix(in srgb, var(--theme-success) 16%, transparent)",
                    }}
                  >
                    <Check size={12} strokeWidth={3.2} />
                  </span>
                  {item}
                </li>
              ))}
            </motion.ul>

            <motion.div
              variants={respectMotion(staggerItem, reduced)}
              className="mt-9 flex flex-col items-center gap-3 sm:flex-row sm:justify-center lg:justify-start"
            >
              <a
                href="/signup"
                onClick={handleCreate}
                className="premium-button premium-button-primary h-12 px-7 text-[15px] rounded-full w-full sm:w-auto inline-flex items-center justify-center gap-2 font-bold whitespace-nowrap"
              >
                Create My Link — It&apos;s Free
                <ArrowRight size={18} />
              </a>
              <span
                className="text-xs font-semibold"
                style={{ color: "var(--bridge-text-muted)" }}
              >
                No credit card. No hassle.
              </span>
            </motion.div>

            <motion.div
              variants={respectMotion(staggerItem, reduced)}
              className="mt-6 flex flex-col items-center gap-3 sm:flex-row sm:justify-center lg:justify-start"
            >
              <DownloadAndroidButton variant="secondary" size="md" label="Download Android App" className="w-full sm:w-auto !bg-white/10 !text-white !border-white/15" />
              <span className="text-xs font-medium" style={{ color: "var(--bridge-text-muted)" }}>
                Prefer the app? Get it on Google Play
              </span>
            </motion.div>
          </div>
        </EdgeLitCard>
      </motion.div>
    </section>
  );
}
