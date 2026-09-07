"use client";

import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { BarChart3, Info, Megaphone, Wrench, Check } from "lucide-react";

import Modal from "@/components/Modal";
import { useAnnouncements, type Announcement } from "@/lib/announcements";
import useSafeReducedMotion from "@/lib/useSafeReducedMotion";
import { spring, tween } from "@/lib/motion";
import { assistantHiddenOn } from "@/lib/ai/pageContext";

/**
 * The announcement popup.
 *
 * Modelled on components/SocialFollowPrompt.tsx — same cadence rules, same
 * "don't land on a page where it would be rude" gate, same dialog family — but
 * driven by a database row instead of a module constant, which is what makes it
 * reusable: an admin publishes an announcement and this is already the thing
 * that shows it.
 *
 * ONE AT A TIME. `active_announcements_for_me()` can return up to five; they are
 * queued and shown in sequence rather than stacked, because three dialogs at once
 * is not an announcement, it's an accident.
 *
 * The CTA is rendered from `cta_href`, which the API validated against an
 * allowlist of internal routes and https hosts Whisper already links to
 * (lib/admin/announcements.ts). An internal path becomes a `Link`; anything else
 * opens in a new tab with `noopener`, which is not optional on a
 * `target=_blank` — without it the opened page gets a handle on `window.opener`.
 */

const KIND_META = {
  info: { icon: Info, label: "Whisper update" },
  cta: { icon: Megaphone, label: "New on Whisper" },
  poll: { icon: BarChart3, label: "Your vote" },
  maintenance: { icon: Wrench, label: "Scheduled maintenance" },
} as const;

export default function AnnouncementPrompt() {
  const pathname = usePathname();
  const router = useRouter();
  const reduced = useSafeReducedMotion();
  const { current, voting, dismiss, vote } = useAnnouncements();
  const [error, setError] = useState<string | null>(null);

  /* The assistant's route list, reused rather than duplicated: the set of pages
     where an uninvited dialog is unwelcome is the same set. */
  if (assistantHiddenOn(pathname)) return null;
  if (!current) return null;

  const meta = KIND_META[current.kind] ?? KIND_META.info;
  const Icon = meta.icon;

  const handleCta = () => {
    const href = current.cta_href;
    dismiss(current.id);
    if (!href) return;
    if (href.startsWith("/")) {
      router.push(href);
      return;
    }
    window.open(href, "_blank", "noopener,noreferrer");
  };

  const handleVote = async (optionIndex: number) => {
    setError(null);
    const result = await vote(current.id, optionIndex);
    if (!result.ok) setError(result.error ?? "Couldn't record that vote.");
  };

  return (
    <Modal
      open
      onClose={() => dismiss(current.id)}
      size="sm"
      showClose
      className="overflow-hidden"
    >
      <AnnouncementBody
        announcement={current}
        accentLabel={meta.label}
        AccentIcon={Icon}
        voting={voting}
        error={error}
        reduced={reduced}
        onVote={handleVote}
        onCta={handleCta}
        onDismiss={() => dismiss(current.id)}
      />
    </Modal>
  );
}

function AnnouncementBody({
  announcement,
  accentLabel,
  AccentIcon,
  voting,
  error,
  reduced,
  onVote,
  onCta,
  onDismiss,
}: {
  announcement: Announcement;
  accentLabel: string;
  AccentIcon: typeof Info;
  voting: boolean;
  error: string | null;
  reduced: boolean;
  onVote: (index: number) => void;
  onCta: () => void;
  onDismiss: () => void;
}) {
  const voted = announcement.my_vote !== null && announcement.my_vote !== undefined;
  const total = Math.max(announcement.total_votes ?? 0, 0);

  return (
    <div className="relative px-6 pb-6 pt-8 text-center">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-40"
        style={{
          background:
            "radial-gradient(58% 68% at 50% 0%, rgba(167,139,250,0.24) 0%, rgba(192,68,145,0.10) 44%, transparent 74%)",
        }}
      />

      {announcement.image_url ? (
        /* `unoptimized` because the source is either a static file in /public or
           an already-delivered Cloudinary URL; running either back through
           next/image's optimizer costs a round trip and gains nothing. */
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={announcement.image_url}
          alt=""
          className="relative mx-auto mb-4 h-28 w-full rounded-2xl object-cover"
        />
      ) : (
        <motion.div
          initial={reduced ? { opacity: 0 } : { scale: 0.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={reduced ? tween.base : spring.snappy}
          className="relative mx-auto grid h-16 w-16 place-items-center rounded-[1.35rem]"
          style={{
            background: "linear-gradient(140deg, #22d3ee 0%, #a78bfa 52%, #c04491 100%)",
            boxShadow: "0 10px 28px rgba(167,139,250,0.32), inset 0 1px 0 rgba(255,255,255,0.42)",
          }}
        >
          <AccentIcon size={26} className="text-white" aria-hidden />
        </motion.div>
      )}

      <motion.div
        initial={reduced ? { opacity: 0 } : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={reduced ? tween.base : { ...tween.base, delay: 0.08 }}
      >
        <span className="inline-block rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[10.5px] font-bold uppercase tracking-wider theme-text-subtle">
          {accentLabel}
        </span>

        <h2 className="mt-3 text-[1.3rem] font-black leading-tight text-white">
          {announcement.title}
        </h2>
        <p className="mx-auto mt-2 max-w-[19rem] whitespace-pre-line text-[13px] leading-relaxed theme-text-muted">
          {announcement.body}
        </p>

        {announcement.kind === "poll" && (
          <PollOptions
            announcement={announcement}
            voted={voted}
            total={total}
            voting={voting}
            reduced={reduced}
            onVote={onVote}
          />
        )}

        {error && (
          <p role="alert" className="mt-3 text-[12px] font-semibold" style={{ color: "var(--theme-error)" }}>
            {error}
          </p>
        )}

        {/* One button for both cases on purpose. `onCta` is what decides between
            a client-side navigation and a new tab, so the markup does not have
            to — and an <a> styled as a button would still fire a full page load
            for an internal route. */}
        {announcement.cta_label && announcement.cta_href && (
          <button
            type="button"
            onClick={onCta}
            className="mt-6 w-full rounded-2xl bg-gradient-to-r from-purple-600 to-fuchsia-500 py-3.5 font-bold text-white transition hover:opacity-90"
          >
            {announcement.cta_label}
          </button>
        )}

        <button
          type="button"
          onClick={onDismiss}
          className="mt-3 w-full py-2 text-[12.5px] font-semibold theme-text-subtle transition hover:opacity-80"
        >
          {announcement.cta_label ? "Maybe later" : "Got it"}
        </button>
      </motion.div>
    </div>
  );
}

function PollOptions({
  announcement,
  voted,
  total,
  voting,
  reduced,
  onVote,
}: {
  announcement: Announcement;
  voted: boolean;
  total: number;
  voting: boolean;
  reduced: boolean;
  onVote: (index: number) => void;
}) {
  const options = announcement.poll_options ?? [];
  const counts = announcement.vote_counts ?? [];

  return (
    <div className="mt-5 space-y-2 text-left" role={voted ? "list" : "radiogroup"} aria-label={announcement.title}>
      {options.map((option, index) => {
        const tally = counts[index] ?? 0;
        /* Zero is shown as 0% rather than blank: a bar that never appears reads
           as a missing option, not as an unpopular one. */
        const pct = total > 0 ? Math.round((tally / total) * 100) : 0;
        const mine = announcement.my_vote === index;

        return (
          <motion.button
            key={`${announcement.id}-${index}`}
            type="button"
            /* A voted poll is a result, not a control. The button stays so the
               row keeps its shape and the reader's own choice stays marked. */
            disabled={voted || voting}
            onClick={() => onVote(index)}
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={reduced ? tween.base : { ...spring.snappy, delay: 0.1 + index * 0.04 }}
            className="relative w-full overflow-hidden rounded-xl border border-white/10 bg-white/5 px-3.5 py-2.5 text-[13px] font-semibold text-white transition disabled:cursor-default enabled:hover:border-purple-400/40 enabled:hover:bg-white/[0.08]"
          >
            {voted && (
              <span
                aria-hidden
                className="absolute inset-y-0 left-0 bg-purple-500/20 transition-[width] duration-500"
                style={{ width: `${pct}%` }}
              />
            )}
            <span className="relative flex items-center justify-between gap-3">
              <span className="flex min-w-0 items-center gap-2">
                {mine && <Check size={13} className="flex-none text-purple-300" strokeWidth={3} />}
                <span className="truncate">{option}</span>
              </span>
              {voted && (
                <span className="flex-none text-[11.5px] font-bold tabular-nums theme-text-muted">
                  {pct}%
                </span>
              )}
            </span>
          </motion.button>
        );
      })}

      <p className="pt-1 text-center text-[11px] theme-text-subtle">
        {voted
          ? `${total} ${total === 1 ? "vote" : "votes"}`
          : voting
            ? "Recording…"
            : "One vote per person"}
      </p>
    </div>
  );
}
