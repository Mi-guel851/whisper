import { useCallback, useState } from "react";

import { claimFeedPhoto, fetchSavedIds, areSavesAvailable, toggleLike as toggleLikeRow, toggleSave } from "@/lib/feed";
import type { FeedImageState } from "@/lib/feedState";
import { optimisticLike, optimisticVote } from "@/lib/feedState";
import { vibrate } from "@/lib/haptics";
import { useSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/lib/toast";
import type { FeedPost } from "@/lib/types";

/**
 * The engagement behind a feed card, in one place.
 *
 * The feed and the saved-posts list render the same `FeedCard` and therefore owe
 * it the same answers: is this liked, how many likes, which poll option is mine,
 * has this photo been claimed, is it saved. Keeping that state in one hook means
 * the two screens cannot drift into disagreeing about the same post — and that a
 * post liked in the feed arrives at the saved list already liked, because both
 * seed from the same server columns.
 *
 * EVERY WRITE HERE IS OPTIMISTIC AND EVERY ONE ROLLS BACK
 *
 * A like has to move the moment a thumb lands on it — a round trip to Lagos
 * over a phone connection is visible. But an optimistic number that is never
 * reconciled is a lie the user can see on the next refresh, so every handler
 * keeps the previous value and puts it back when the request fails.
 *
 * The authoritative counts come from the server on the next page fetch, and
 * `seed` is what applies them: a row that has just arrived overwrites whatever
 * this session had guessed.
 */
export function useFeedEngagement(viewerId: string | null) {
  const { session } = useSession();
  const { showToast } = useToast();

  const [liked, setLiked] = useState<Record<string, boolean>>({});
  const [likeCounts, setLikeCounts] = useState<Record<string, number>>({});
  const [replyCounts, setReplyCounts] = useState<Record<string, number>>({});
  const [imageStates, setImageStates] = useState<Record<string, FeedImageState>>({});
  const [imageUris, setImageUris] = useState<Record<string, string>>({});
  const [pollCounts, setPollCounts] = useState<Record<string, number[]>>({});
  const [pollChoices, setPollChoices] = useState<Record<string, number>>({});
  const [pollPending, setPollPending] = useState<Record<string, boolean>>({});
  const [savedIds, setSavedIds] = useState<Record<string, boolean>>({});
  /* The save migration is applied by hand, so the bookmark stays hidden until a
     save is known to work. A control that looks tappable and does nothing costs
     more trust than a missing one. */
  const [savesAvailable, setSavesAvailable] = useState(false);

  /**
   * Merges the engagement columns of freshly arrived rows.
   *
   * Called once per page rather than per card: the counts on a row are the
   * server's answer for this viewer, and an optimistic update from a moment ago
   * is superseded by it.
   */
  const seed = useCallback((rows: FeedPost[], viewer: string) => {
    if (rows.length === 0) return;

    setLiked((value) => {
      const merged = { ...value };
      for (const row of rows) merged[row.id] = Boolean(row.viewer_liked);
      return merged;
    });
    setLikeCounts((value) => {
      const merged = { ...value };
      for (const row of rows) merged[row.id] = Number(row.like_count ?? 0);
      return merged;
    });
    setReplyCounts((value) => {
      const merged = { ...value };
      for (const row of rows) merged[row.id] = Number(row.reply_count ?? 0);
      return merged;
    });
    setImageStates((value) => {
      const merged = { ...value };
      for (const row of rows) {
        if (row.has_image && !merged[row.id]) {
          merged[row.id] = row.author_id === viewer || row.viewer_image_viewed ? "spent" : "locked";
        }
      }
      return merged;
    });
    setPollChoices((value) => {
      const merged = { ...value };
      for (const row of rows) if (typeof row.viewer_vote === "number") merged[row.id] = row.viewer_vote;
      return merged;
    });
    setPollCounts((value) => {
      const merged = { ...value };
      for (const row of rows) if (row.poll_counts) merged[row.id] = row.poll_counts;
      return merged;
    });
  }, []);

  /** One query per page for the bookmark states, not one per card. */
  const markSaved = useCallback(async (rows: FeedPost[]) => {
    if (rows.length === 0) return;

    const ids = await fetchSavedIds(rows.map((row) => row.id));
    const known = areSavesAvailable();

    setSavesAvailable(known !== false);
    /* A failed call reports an empty set. Writing that as "nothing is saved"
       would clear bookmarks the user really has, so it is only trusted when the
       RPC is known to work. */
    if (known !== true && ids.size === 0) return;

    setSavedIds((value) => {
      const merged = { ...value };
      for (const row of rows) merged[row.id] = ids.has(row.id);
      return merged;
    });
  }, []);

  const toggleLike = useCallback(
    async (post: FeedPost) => {
      if (!viewerId) return;

      const wasLiked = Boolean(liked[post.id]);
      const optimistic = optimisticLike(likeCounts[post.id] ?? 0, wasLiked);

      setLiked((value) => ({ ...value, [post.id]: optimistic.liked }));
      setLikeCounts((value) => ({ ...value, [post.id]: optimistic.count }));
      vibrate("select");

      try {
        await toggleLikeRow(post.id, viewerId, wasLiked);
      } catch {
        /* Undo in both places, or the button disagrees with the server until the
           next reload. */
        setLiked((value) => ({ ...value, [post.id]: wasLiked }));
        setLikeCounts((value) => ({ ...value, [post.id]: likeCounts[post.id] ?? 0 }));
        showToast("Couldn't save that like.", { variant: "error" });
      }
    },
    [likeCounts, liked, showToast, viewerId]
  );

  const vote = useCallback(
    async (post: FeedPost, optionIndex: number) => {
      if (!viewerId || pollPending[post.id]) return;

      const previous = pollChoices[post.id] ?? null;
      setPollPending((value) => ({ ...value, [post.id]: true }));
      setPollChoices((value) => ({ ...value, [post.id]: optionIndex }));
      setPollCounts((value) => ({
        ...value,
        [post.id]: optimisticVote(value[post.id] ?? post.poll_counts ?? [], previous, optionIndex),
      }));
      vibrate("select");

      const { error } = await supabase.rpc("vote_public_feed_poll", {
        p_post_id: post.id,
        p_option_index: optionIndex,
      });

      setPollPending((value) => ({ ...value, [post.id]: false }));

      if (error) {
        setPollChoices((value) => {
          const next = { ...value };
          if (previous === null) delete next[post.id];
          else next[post.id] = previous;
          return next;
        });
        showToast("Couldn't record that vote.", { variant: "error" });
      }
    },
    [pollChoices, pollPending, showToast, viewerId]
  );

  /**
   * Claims a view-once photo whisper.
   *
   * The bytes only exist after this call — the feed carries a blurred preview —
   * because the view-once rule is enforced on the server. Your own photo is
   * already yours, and asking the server to spend your own view is the bug this
   * branch exists to prevent.
   */
  const openPhoto = useCallback(
    async (post: FeedPost) => {
      if (!session?.access_token) return;
      if (post.author_id === viewerId) {
        showToast("This is your own photo whisper.", { variant: "subtle" });
        return;
      }

      setImageStates((value) => ({ ...value, [post.id]: "loading" }));
      const result = await claimFeedPhoto(post.id, session.access_token);

      if ("error" in result) {
        setImageStates((value) => ({ ...value, [post.id]: "unavailable" }));
        showToast(result.error, { variant: "error" });
        return;
      }

      setImageUris((value) => ({ ...value, [post.id]: result.uri }));
      setImageStates((value) => ({ ...value, [post.id]: "spent" }));
    },
    [session?.access_token, showToast, viewerId]
  );

  /**
   * Saving is private: the author is never told, and nothing is counted.
   *
   * Returns the state the server settled on — `true` saved, `false` unsaved,
   * `null` when this database has no save table — because a screen whose list
   * *is* the set of saves (the saved-posts screen) has to know whether the row it
   * just removed should come back. It does not throw: every path is reported, so
   * a caller that ignores the result cannot end up with an unhandled rejection.
   */
  const toggleSaved = useCallback(
    async (post: FeedPost): Promise<boolean | null> => {
      const wasSaved = Boolean(savedIds[post.id]);
      setSavedIds((value) => ({ ...value, [post.id]: !wasSaved }));
      vibrate("select");

      try {
        const nowSaved = await toggleSave(post.id);

        if (nowSaved === null) {
          setSavesAvailable(false);
          setSavedIds((value) => ({ ...value, [post.id]: wasSaved }));
          return null;
        }

        setSavedIds((value) => ({ ...value, [post.id]: nowSaved }));
        showToast(nowSaved ? "Saved — it's in your saved posts." : "Removed from saved.", {
          variant: "subtle",
        });
        return nowSaved;
      } catch {
        setSavedIds((value) => ({ ...value, [post.id]: wasSaved }));
        showToast("Couldn't save that whisper.", { variant: "error" });
        return wasSaved;
      }
    },
    [savedIds, showToast]
  );

  return {
    liked,
    likeCounts,
    replyCounts,
    imageStates,
    imageUris,
    pollCounts,
    pollChoices,
    pollPending,
    savedIds,
    savesAvailable,
    seed,
    markSaved,
    toggleLike,
    vote,
    openPhoto,
    toggleSaved,
  };
}
