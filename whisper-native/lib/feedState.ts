/**
 * The small pieces of feed state that more than one component needs.
 *
 * Kept out of the components themselves because the type is the contract
 * between a card, its screen and the API call that fills it — and a type that
 * lives inside one component is a type the other two have to guess at.
 */

/**
 * Lifecycle of a photo whisper, from this viewer's side.
 *
 *   locked       the blurred preview, one tap from being spent
 *   loading      the claim request is in flight
 *   spent        this viewer has had their look; it will not come back
 *   unavailable  expired, removed, or the server refused
 */
export type FeedImageState = "locked" | "loading" | "spent" | "unavailable";

/** One option in the feed's overflow sheet. */
export type FeedMenuAction =
  | "copy-link"
  | "share"
  | "save"
  | "report"
  | "block"
  | "delete";

/**
 * Slides a like count in the direction the viewer just changed it, before the
 * server agrees — and reconciles silently when it does.
 *
 * The optimistic number is what makes a like feel instant on a slow connection.
 * It is also the reason the server's count has to win on refresh: a like that
 * was refused must not leave a permanently inflated number on screen.
 */
export function optimisticLike(
  count: number | null | undefined,
  liked: boolean | null | undefined
): { count: number; liked: boolean } {
  const current = Number(count) || 0;
  const wasLiked = Boolean(liked);
  return {
    liked: !wasLiked,
    count: Math.max(0, current + (wasLiked ? -1 : 1)),
  };
}

/** The same thing for a poll, where one option's vote is the viewer's only one. */
export function optimisticVote(
  counts: number[] | null | undefined,
  previous: number | null | undefined,
  next: number
): number[] {
  const copy = [...(counts ?? [])];
  while (copy.length < next + 1) copy.push(0);

  if (typeof previous === "number" && previous >= 0 && previous < copy.length) {
    copy[previous] = Math.max(0, (Number(copy[previous]) || 0) - 1);
  }
  copy[next] = (Number(copy[next]) || 0) + 1;
  return copy;
}
