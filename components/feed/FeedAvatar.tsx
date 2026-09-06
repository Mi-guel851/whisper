"use client";

import { generatedAvatarUrl } from "@/lib/generatedAvatar";
import { OFFICIAL_IDENTITY } from "@/lib/creator";

/**
 * The identity chip for a feed author.
 *
 * Whisper identities are generated, not uploaded, so the avatar carries no
 * information on its own — the gradient ring is what makes a row of otherwise
 * similar glyphs scannable, and it's the same accent the rest of the app uses.
 *
 * `official` swaps the generated face for the Whisper mark. Callers pass it
 * only from a trusted source (`isCreatorPost(row)` on a database row, or
 * `useCreatorAccess()` for the signed-in account). An ordinary user cannot pick
 * this: avatars here are a pure function of the user id and there is no
 * upload path into the feed at all.
 */
export default function FeedAvatar({
  authorId,
  size = 40,
  official = false,
}: {
  authorId: string;
  size?: number;
  official?: boolean;
}) {
  if (official) {
    return (
      <span
        className="feed-avatar-ring feed-avatar-official relative inline-flex shrink-0 items-center justify-center rounded-full"
        style={{ width: size, height: size }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={OFFICIAL_IDENTITY.avatarSrc}
          alt=""
          aria-hidden="true"
          className="feed-avatar-img feed-avatar-official-img h-full w-full rounded-full object-contain"
        />
      </span>
    );
  }

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
