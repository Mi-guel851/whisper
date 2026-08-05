"use client";

import { generatedAvatarUrl } from "@/lib/generatedAvatar";

/**
 * The identity chip for a feed author.
 *
 * Whisper identities are generated, not uploaded, so the avatar carries no
 * information on its own — the gradient ring is what makes a row of otherwise
 * similar glyphs scannable, and it's the same accent the rest of the app uses.
 */
export default function FeedAvatar({
  authorId,
  size = 40,
}: {
  authorId: string;
  size?: number;
}) {
  return (
    <span
      className="feed-avatar-ring relative inline-flex shrink-0 items-center justify-center rounded-full"
      style={{ width: size, height: size }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={generatedAvatarUrl(authorId)}
        alt=""
        aria-hidden="true"
        className="feed-avatar-img h-full w-full rounded-full object-cover"
      />
    </span>
  );
}
