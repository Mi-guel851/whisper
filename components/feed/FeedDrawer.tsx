"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import Link from "next/link";
import {
  BarChart3,
  Bookmark,
  Compass,
  Crown,
  Gamepad2,
  Settings,
  User,
  Users,
  type LucideIcon,
} from "lucide-react";
import FeedAvatar from "./FeedAvatar";
import FeedDiscovery from "./FeedDiscovery";
import WhisperCoinIcon from "@/components/WhisperCoinIcon";
import { supabase } from "@/lib/supabase/client";
import type { FeedPost } from "@/lib/feed";
import { spring, tween } from "@/lib/motion";
import { vibrate, HAPTIC } from "@/lib/haptics";

/**
 * The feed's left drawer — everything that used to sit on top of the timeline.
 *
 * WHY THESE THINGS MOVED IN HERE
 *
 * The Daily Question, Whisper of the Day, Surprise Me and the spark cluster were
 * all stacked above the first whisper, so the feed opened on roughly a full screen
 * of chrome before a single post. Each one is worth having and none of them is
 * worth the top of the screen every single visit: they are things you go *looking*
 * for, once, not things you need in view while reading forty posts. A drawer is the
 * right home for exactly that class of feature, which is why X puts its equivalents
 * there too.
 *
 * They are moved, not rebuilt — `FeedDiscovery` is the same component with the same
 * props, rendered in a different place. The poll composer is reached through the
 * "Start a poll" row, which opens the composer already switched to poll mode; the
 * poll UI itself stays in `FeedComposer` where it belongs.
 *
 * WHY THIS OWNS A PORTAL INSTEAD OF USING <Modal>
 *
 * Modal has `center` and `sheet` variants — both centre horizontally, and `sheet`
 * drags on Y. A left drawer needs the opposite of all of that: pinned to the left
 * edge, full height, and dismissed by dragging *left*. Bending Modal into a third
 * shape would have meant three variants' worth of conditionals in a file every
 * dialog in the app depends on, so this keeps its own portal — the same call the
 * photo viewer makes, for the same reason.
 *
 * Scroll lock, Escape, focus-on-open and focus restore are duplicated from Modal
 * deliberately: they are about twenty lines, and they are the difference between a
 * panel and a dialog.
 */

type NavRow = {
  href: string;
  label: string;
  icon: LucideIcon;
};

/* Mirrors the bottom nav's destinations plus the ones it has no room for. Order
   is by how often somebody actually goes there from a feed, not alphabetical. */
const PRIMARY_ROWS: NavRow[] = [
  { href: "/profile", label: "Profile", icon: User },
  { href: "/friends", label: "Friends", icon: Users },
  { href: "/discover", label: "Discover", icon: Compass },
  { href: "/saved-posts", label: "Saved posts", icon: Bookmark },
  { href: "/analytics", label: "Your stats", icon: BarChart3 },
  { href: "/games", label: "Games", icon: Gamepad2 },
];

const FOOTER_ROWS: NavRow[] = [
  { href: "/premium", label: "Whisper+", icon: Crown },
  { href: "/settings", label: "Settings and privacy", icon: Settings },
];

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

type FeedDrawerProps = {
  open: boolean;
  onClose: () => void;
  authorId: string;
  /** The signed-in user's generated feed name, e.g. "dark.wolf". */
  displayName: string;
  handle: string | null;
  /** Discovery — passed straight through to the existing component. */
  question: string;
  spotlight: FeedPost | null;
  surprising: boolean;
  onAnswerQuestion: () => void;
  onOpenSpotlight: (post: FeedPost) => void;
  onSurprise: () => void;
  onStartPoll: () => void;
  reducedMotion: boolean;
};

export default function FeedDrawer({
  open,
  onClose,
  authorId,
  displayName,
  handle,
  question,
  spotlight,
  surprising,
  onAnswerQuestion,
  onOpenSpotlight,
  onSurprise,
  onStartPoll,
  reducedMotion,
}: FeedDrawerProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  /*
   * The coin balance, read here rather than passed in.
   *
   * It is the one number this panel can show that is both real and useful — the
   * compose button below it spends coins, so the balance is the answer to "can I
   * post right now". Fetched only once the drawer has actually been opened, and
   * re-read on every open so it cannot go stale after a post: a wallet figure that
   * is quietly two posts out of date is worse than no wallet figure.
   *
   * `null` renders nothing at all. There is no placeholder count here — a fake
   * "312 following" would be a lie dressed as social proof.
   */
  const [coins, setCoins] = useState<number | null>(null);

  useEffect(() => {
    if (!open || !authorId) return;
    let cancelled = false;

    (async () => {
      const { data } = await supabase
        .from("coins")
        .select("balance")
        .eq("user_id", authorId)
        .maybeSingle();
      if (!cancelled) setCoins(typeof data?.balance === "number" ? data.balance : null);
    })();

    return () => {
      cancelled = true;
    };
  }, [open, authorId]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
        return;
      }

      if (event.key !== "Tab" || !panelRef.current) return;

      const focusable = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)
      ).filter((el) => el.offsetParent !== null);

      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    },
    [onClose]
  );

  useEffect(() => {
    if (!open) return;

    restoreFocusRef.current = document.activeElement as HTMLElement | null;

    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
    const { overflow, paddingRight } = document.body.style;
    document.body.style.overflow = "hidden";
    if (scrollbarWidth > 0) document.body.style.paddingRight = `${scrollbarWidth}px`;

    document.addEventListener("keydown", handleKeyDown, true);

    const raf = requestAnimationFrame(() => {
      const target = panelRef.current?.querySelector<HTMLElement>(FOCUSABLE);
      (target ?? panelRef.current)?.focus();
    });

    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("keydown", handleKeyDown, true);
      document.body.style.overflow = overflow;
      document.body.style.paddingRight = paddingRight;
      restoreFocusRef.current?.focus?.();
    };
  }, [open, handleKeyDown]);

  /* A drawer's rows are links. Closing on navigation is not optional — the panel
     would otherwise still be open, over the new page, after the router settles. */
  const closeOnNavigate = useCallback(() => {
    vibrate(HAPTIC.tap);
    onClose();
  }, [onClose]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="feed-drawer-layer">
          <motion.div
            className="feed-drawer-scrim"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={tween.base}
            onClick={onClose}
          />

          <motion.aside
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label="Menu"
            tabIndex={-1}
            className="feed-drawer"
            initial={{ x: "-100%" }}
            animate={{ x: 0 }}
            exit={{ x: "-100%" }}
            transition={reducedMotion ? { duration: 0.14 } : spring.gentle}
            /* Drag left to dismiss, matching the direction it entered from —
               anything else breaks the spatial link between gesture and panel.
               `dragElastic` only on the left so it cannot be pulled open wider
               than it is. */
            drag={reducedMotion ? false : "x"}
            dragConstraints={{ left: 0, right: 0 }}
            dragElastic={{ left: 0.35, right: 0 }}
            dragMomentum={false}
            onDragEnd={(_, info) => {
              if (info.offset.x < -80 || info.velocity.x < -420) onClose();
            }}
          >
            <div className="feed-drawer-scroll">
              <header className="feed-drawer-head">
                <Link
                  href="/profile"
                  onClick={closeOnNavigate}
                  className="feed-drawer-identity"
                >
                  <FeedAvatar authorId={authorId} size={48} />
                  <span className="feed-drawer-names">
                    <span className="feed-drawer-name">{displayName}</span>
                    {handle && <span className="feed-drawer-handle">@{handle}</span>}
                  </span>
                </Link>

                {/* Real numbers or nothing. A coin balance is the one count this
                    panel can state truthfully, and it is the one that matters
                    next to a button that spends them. */}
                {coins !== null && (
                  <Link
                    href="/premium"
                    onClick={closeOnNavigate}
                    className="feed-drawer-stats"
                  >
                    <WhisperCoinIcon size={14} />
                    <strong className="tabular-nums">{coins}</strong>
                    <span>{coins === 1 ? "coin" : "coins"}</span>
                  </Link>
                )}
              </header>

              {/* The moved discovery block, unchanged. */}
              <div className="feed-drawer-discovery">
                <FeedDiscovery
                  question={question}
                  spotlight={spotlight}
                  surprising={surprising}
                  onAnswerQuestion={() => {
                    onClose();
                    onAnswerQuestion();
                  }}
                  onOpenSpotlight={(post) => {
                    onClose();
                    onOpenSpotlight(post);
                  }}
                  onSurprise={() => {
                    onClose();
                    onSurprise();
                  }}
                  reducedMotion={reducedMotion}
                />
              </div>

              <button
                type="button"
                onClick={() => {
                  vibrate(HAPTIC.select);
                  onClose();
                  onStartPoll();
                }}
                className="feed-drawer-poll"
              >
                <BarChart3 size={16} aria-hidden />
                <span>
                  Start a poll
                  <small>Ask the feed to pick a side</small>
                </span>
              </button>

              <nav className="feed-drawer-nav" aria-label="Go to">
                {PRIMARY_ROWS.map(({ href, label, icon: Icon }) => (
                  <Link
                    key={href}
                    href={href}
                    onClick={closeOnNavigate}
                    className="feed-drawer-row"
                  >
                    <Icon size={19} aria-hidden />
                    {label}
                  </Link>
                ))}
              </nav>

              <nav className="feed-drawer-nav is-footer" aria-label="Account">
                {FOOTER_ROWS.map(({ href, label, icon: Icon }) => (
                  <Link
                    key={href}
                    href={href}
                    onClick={closeOnNavigate}
                    className="feed-drawer-row is-quiet"
                  >
                    <Icon size={18} aria-hidden />
                    {label}
                  </Link>
                ))}
              </nav>
            </div>
          </motion.aside>
        </div>
      )}
    </AnimatePresence>,
    document.body
  );
}
