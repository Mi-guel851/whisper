import { redirect } from "next/navigation";

/**
 * The old name for Saved posts.
 *
 * The feature was called "Saved Messages" while it was a placeholder, which was
 * always the wrong noun: it saves public-feed posts, not the private messages in the
 * inbox, and two features whose names suggest the same thing is exactly how someone
 * ends up looking for a saved whisper in their DMs.
 *
 * A redirect rather than a deletion, because this path is already in the wild — it
 * has been linked from the feed drawer, and a bookmark or a back-button landing on a
 * 404 is a worse outcome than one extra file. Permanent, so clients and crawlers
 * stop asking.
 */
export default function SavedMessagesRedirect() {
  redirect("/saved-posts");
}
