"use client";

import { memo } from "react";
import { Menu } from "lucide-react";
import FeedAvatar from "./FeedAvatar";
import { vibrate, HAPTIC } from "@/lib/haptics";

/**
 * The feed's top bar: identity on the left, the mark in the middle, nothing loud
 * on the right.
 *
 * X's arrangement, and it is worth saying why it is the right one rather than
 * just the familiar one. A feed is somewhere people arrive with no particular
 * goal, so the bar's job is to be *ignorable* — it has to stay out of the way
 * while remaining the way out. Putting the account on the left makes the drawer
 * reachable by the thumb that is already holding the phone, and leaves the whole
 * centre free for the one thing that says where you are.
 *
 * The avatar doubles as the drawer trigger, which is why there is no hamburger
 * next to it: two controls opening the same panel is one too many. The small
 * glyph sits *inside* the avatar's ring as an affordance, because an avatar alone
 * reads as "go to my profile" and this does not do that.
 *
 * Everything that used to sit above the timeline — the page title, the subtitle,
 * the Daily Question, Whisper of the Day, Surprise Me — has moved out. The title
 * is redundant with the mark, and the rest is in the drawer.
 */

type FeedTopBarProps = {
  authorId: string;
  onOpenDrawer: () => void;
  onOpenSearch: () => void;
  searchOpen: boolean;
  /** Draws the attention dot on the drawer button. */
  hasDiscovery: boolean;
};

function FeedTopBarBase({
  authorId,
  onOpenDrawer,
  onOpenSearch,
  searchOpen,
  hasDiscovery,
}: FeedTopBarProps) {
  return (
    <header className="feed-topbar">
      <button
        type="button"
        onClick={() => {
          vibrate(HAPTIC.tap);
          onOpenDrawer();
        }}
        aria-label="Open menu"
        aria-haspopup="dialog"
        className="feed-topbar-account"
      >
        {/* The badge and the dot hang off the *avatar*, not off the button. The
            button is deliberately larger than the avatar to reach the 44px touch
            minimum, so anchoring them to it would float them out in the padding. */}
        <span className="feed-topbar-account-avatar">
          <FeedAvatar authorId={authorId} size={32} />
          <span aria-hidden className="feed-topbar-account-glyph">
            <Menu size={9} strokeWidth={3.5} />
          </span>
          {/* Says "there is something in here" while the Daily Question is
              unanswered and out of sight. Absent once there is nothing to find,
              rather than a permanent decoration people learn to ignore. */}
          {hasDiscovery && <span aria-hidden className="feed-topbar-dot" />}
        </span>
      </button>

      <span className="feed-topbar-mark" aria-hidden>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/ghost.png" alt="" width={26} height={26} />
      </span>

      <button
        type="button"
        onClick={() => {
          vibrate(HAPTIC.tap);
          onOpenSearch();
        }}
        aria-expanded={searchOpen}
        aria-label={searchOpen ? "Close search" : "Search whispers"}
        className={`feed-topbar-search ${searchOpen ? "is-active" : ""}`}
      >
        Search
      </button>
    </header>
  );
}

export const FeedTopBar = memo(FeedTopBarBase);
export default FeedTopBar;
