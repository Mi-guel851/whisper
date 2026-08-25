import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

import { FEED_POST_COST, FEED_REPLY_COST } from "@/lib/coins";
import { CLOUDINARY_FOLDERS, cloudinaryPublicId } from "@/lib/cloudinary";
import { cloudinaryImageExists, destroyCloudinaryUrl } from "@/lib/cloudinary.server";

/**
 * Creating something on the Public Feed.
 *
 * Supersedes `/api/coins/reply`, which charged for replies and let root posts
 * through free. That is now inverted: **a root post costs 2 coins, a reply is
 * free.** Posting is the act with reach — it goes to everyone and carries the
 * author's Whisper link — so it is the one worth pricing. Charging for replies
 * priced the conversation instead, which is the part a feed needs most.
 *
 * Both go through this one route rather than the reply being a direct client
 * insert, because the threaded-insert fallback and the `whisper_link` lookup
 * below are the fiddly parts and duplicating them client-side would mean two
 * places to keep correct. A free reply pays one serverless hop for that; it is
 * not on a latency-critical path.
 *
 * The charge is derived from the body server-side. A client claiming "this is a
 * reply" to dodge the fee would have to send a `parentPostId`, which makes it an
 * actual reply — so there is nothing to spoof.
 *
 * Attachments (topic, photo, poll) are validated here rather than trusted, and
 * every one of them is checked against the same rules the table's constraints
 * enforce. Two layers agreeing is the point: the constraint is the guarantee, and
 * this is what turns a violation into a sentence the user can act on instead of a
 * 500.
 */

/** Must mirror `public_feed_posts_topic_check`. */
const TOPICS = new Set([
  "confession",
  "advice",
  "love",
  "vent",
  "funny",
  "deep",
  "question",
  "random",
]);

const MAX_POLL_OPTIONS = 4;
const MAX_POLL_OPTION_CHARS = 60;
const MAX_PREVIEW_CHARS = 4000;

/**
 * Whether an insert failed because the schema is missing a column, as opposed to
 * the row being invalid.
 *
 * The distinction decides between "retry with less" and "tell the user". PostgREST
 * reports an unknown column on write as PGRST204 from its schema cache; Postgres
 * itself reports 42703 when the cache is stale enough to let the statement
 * through.
 */
function isMissingColumn(error: { code?: string; message?: string }) {
  if (error.code === "PGRST204" || error.code === "42703") return true;
  return /column .* does not exist|could not find the .* column/i.test(error.message ?? "");
}

/** Shape of the row we insert. Loose because the optional columns depend on
 *  which migrations have been applied. */
type InsertBody = {
  author_id: string;
  body: string;
  whisper_link: string | null;
  parent_post_id?: string;
  topic?: string;
  image_path?: string;
  image_preview?: string;
  poll_options?: string[];
};

const BASE = "id,author_id,body,whisper_link,created_at,expires_at";
/** What the client is allowed to read back. `image_path` is never returned — the
 *  key embeds the author's id, and correlating two anonymous posts to one author
 *  is the leak that matters in this feed. */
const RETURN_COLUMNS = `${BASE},parent_post_id,view_count,topic,image_preview,poll_options`;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    /* The table caps a body at 500 characters. Accepting more meant a long post
       passed validation, took the coins, and was then rejected by the insert —
       the user paid for something that never appeared. */
    const text = String(body?.message || "").trim().slice(0, 500);

    /* `postId` is the legacy name the old reply route used; `parentPostId` is the
       clearer one. Both accepted so a stale client keeps working through a
       deploy. */
    const parentPostId = body?.parentPostId ?? body?.postId;
    const isReply = typeof parentPostId === "string" && parentPostId.length > 0;

    if (!text) {
      return NextResponse.json(
        { error: isReply ? "Write a reply first" : "Write something first" },
        { status: 400 }
      );
    }

    /* ------------------------------------------------------------------
       Attachments
       ------------------------------------------------------------------ */

    const topic = typeof body?.topic === "string" && body.topic ? body.topic : null;
    if (topic && !TOPICS.has(topic)) {
      return NextResponse.json({ error: "That topic doesn't exist." }, { status: 400 });
    }

    const imagePath = typeof body?.imagePath === "string" && body.imagePath ? body.imagePath : null;
    const imagePreview =
      typeof body?.imagePreview === "string" && body.imagePreview ? body.imagePreview : null;

    /* A photo with no preview would be a locked plate with nothing under it, and
       it would also break the fallback reader, which infers "has a photo" from the
       preview's presence. Requiring both keeps that inference exact. */
    if (imagePath && !imagePreview) {
      return NextResponse.json(
        { error: "That photo couldn't be prepared. Please pick it again." },
        { status: 400 }
      );
    }
    if (imagePreview && imagePreview.length > MAX_PREVIEW_CHARS) {
      return NextResponse.json({ error: "That photo preview is too large." }, { status: 400 });
    }

    const rawPollOptions = Array.isArray(body?.pollOptions) ? body.pollOptions : null;
    let pollOptions: string[] | null = null;

    if (rawPollOptions) {
      const cleaned = rawPollOptions
        .map((option: unknown) => String(option ?? "").trim())
        .filter((option: string) => option.length > 0)
        .slice(0, MAX_POLL_OPTIONS);

      if (cleaned.length < 2) {
        return NextResponse.json({ error: "A poll needs at least two choices." }, { status: 400 });
      }
      if (cleaned.some((option: string) => option.length > MAX_POLL_OPTION_CHARS)) {
        return NextResponse.json(
          { error: `Keep each choice under ${MAX_POLL_OPTION_CHARS} characters.` },
          { status: 400 }
        );
      }
      pollOptions = cleaned;
    }

    /* Polls are a root-post feature. `public_feed_thread` doesn't compute tallies
       for replies, so a poll down a thread would render bars that never move —
       which is exactly the kind of control that looks real and isn't. */
    if (pollOptions && isReply) {
      return NextResponse.json({ error: "Polls can't be added to a reply." }, { status: 400 });
    }
    if (pollOptions && imagePath) {
      return NextResponse.json(
        { error: "Add a photo or a poll, not both." },
        { status: 400 }
      );
    }

    const authHeader = req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    const accessToken = authHeader.slice("Bearer ".length);

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !anonKey || !serviceKey) {
      console.error("[coins/feed-post] Supabase environment variables are not set.");
      return NextResponse.json({ error: "Server not configured" }, { status: 500 });
    }

    const supabaseAuth = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const {
      data: { user },
      error: userError,
    } = await supabaseAuth.auth.getUser(accessToken);

    if (userError || !user) {
      return NextResponse.json({ error: "Invalid session" }, { status: 401 });
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    /**
     * Confirm the photo is this author's, and that it is actually there.
     *
     * The client uploads straight to Cloudinary and sends the resulting URL, so
     * this is the boundary where an arbitrary string becomes a trusted image
     * reference. Both halves matter: the folder check is the security one, the
     * existence check is the correctness one.
     */
    if (imagePath) {
      /* The value is a Cloudinary delivery URL. The ownership test is the folder,
         which is the same test the old bucket policy applied to the object key:
         assets land in `whisper/feed-photos/<author-id>/<random>`, so the segment
         before the filename says whose photo this is. A URL from another cloud,
         another folder, or somebody else's id is refused without a network call. */
      const publicId = cloudinaryPublicId(imagePath);
      const expectedFolder = `${CLOUDINARY_FOLDERS.feedPhotos}/${user.id}/`;

      if (!publicId || !publicId.startsWith(expectedFolder) || publicId === expectedFolder) {
        return NextResponse.json({ error: "That photo isn't yours." }, { status: 403 });
      }

      /* And that it actually arrived. A post referencing a missing image renders
         as a locked plate that never opens — and the author has been charged for
         it. Checked before any coins move, so this is a 400 rather than a charge
         followed by a refund. */
      if (!(await cloudinaryImageExists(imagePath))) {
        return NextResponse.json(
          { error: "That photo didn't finish uploading. Try again." },
          { status: 400 }
        );
      }
    }

    const cost = isReply ? FEED_REPLY_COST : FEED_POST_COST;

    /* Balance is only read, debited and rolled back when there is something to
       charge. A free reply touches the wallet not at all — no read, no write, no
       zero-amount ledger row to explain later. */
    let balanceBefore = 0;
    let balanceAfter = 0;

    if (cost > 0) {
      const { data: wallet, error: walletError } = await supabaseAdmin
        .from("coins")
        .select("balance")
        .eq("user_id", user.id)
        .maybeSingle();

      if (walletError) {
        console.error("[coins/feed-post] wallet read error:", walletError.message);
        return NextResponse.json({ error: "Failed to read wallet" }, { status: 500 });
      }

      balanceBefore = Number((wallet as { balance?: number } | null)?.balance ?? 0);

      if (balanceBefore < cost) {
        return NextResponse.json(
          {
            error: `Posting costs ${cost} coins and you have ${balanceBefore}. Top up in the Coin Store.`,
          },
          { status: 402 }
        );
      }

      balanceAfter = balanceBefore - cost;

      const { error: updateError } = await supabaseAdmin
        .from("coins")
        .update({ balance: balanceAfter })
        .eq("user_id", user.id);

      if (updateError) {
        console.error("[coins/feed-post] balance update error:", updateError.message);
        return NextResponse.json({ error: "Failed to update balance" }, { status: 500 });
      }

      const { error: ledgerError } = await supabaseAdmin.from("coin_transactions").insert([
        {
          user_id: user.id,
          amount: -cost,
          description: "Public feed post",
          transaction_type: "spend",
        },
      ]);

      if (ledgerError) {
        console.error("[coins/feed-post] transaction insert error:", ledgerError.message);
        await supabaseAdmin
          .from("coins")
          .update({ balance: balanceBefore })
          .eq("user_id", user.id);
        return NextResponse.json({ error: "Failed to record transaction" }, { status: 500 });
      }
    }

    /**
     * Put the balance and the ledger back.
     *
     * The insert below is the thing being paid for, so a failure there cannot be
     * swallowed — the original version of this logged the error and still
     * returned `success: true`, which charged for a post that never appeared.
     */
    async function refund(reason: string) {
      if (cost <= 0) return;
      await supabaseAdmin.from("coins").update({ balance: balanceBefore }).eq("user_id", user!.id);
      await supabaseAdmin.from("coin_transactions").insert([
        {
          user_id: user!.id,
          amount: cost,
          description: "Refund: public feed post failed",
          transaction_type: "refund",
        },
      ]);
      console.error("[coins/feed-post] refunded:", reason);
    }

    let createdPost: unknown = null;
    let postFailure = "";
    let attachmentUnsupported = false;

    try {
      const { data: profile } = await supabaseAdmin
        .from("profiles")
        .select("username")
        .eq("id", user.id)
        .maybeSingle();

      const insertBody: InsertBody = {
        author_id: user.id,
        body: text,
        whisper_link: profile?.username ? `/u/${profile.username}` : null,
      };
      if (isReply) insertBody.parent_post_id = parentPostId;
      if (topic) insertBody.topic = topic;
      if (imagePath && imagePreview) {
        insertBody.image_path = imagePath;
        insertBody.image_preview = imagePreview;
      }
      if (pollOptions) insertBody.poll_options = pollOptions;

      const hasAttachment = Boolean(imagePath || pollOptions);

      const rowWithout = (
        ...keys: Array<"topic" | "parent_post_id" | "image_path" | "image_preview" | "poll_options">
      ) => {
        const copy: InsertBody = { ...insertBody };
        for (const key of keys) delete copy[key];
        return copy;
      };

      /**
       * Insert attempts, most complete first.
       *
       * Each fallback drops a column an unmigrated database might not have — but
       * only ever a *topic* or the *threading link*, both of which a post reads
       * fine without. A photo or a poll is never dropped: charging someone for a
       * photo whisper and then publishing a post with no photo in it is worse than
       * telling them the server can't take one yet.
       */
      const attempts: Array<{ row: InsertBody; select: string; note: string }> = [
        { row: insertBody, select: RETURN_COLUMNS, note: "full" },
      ];

      if (!hasAttachment) {
        if (insertBody.topic) {
          attempts.push({
            row: rowWithout("topic", "image_path", "image_preview", "poll_options"),
            select: `${BASE},parent_post_id`,
            note: "without topic",
          });
        }
        if (isReply) {
          attempts.push({
            row: rowWithout("topic", "parent_post_id", "image_path", "image_preview", "poll_options"),
            select: BASE,
            note: "flat",
          });
        }
      }

      for (const attempt of attempts) {
        const result = await supabaseAdmin
          .from("public_feed_posts")
          .insert([attempt.row])
          .select(attempt.select)
          .single();

        if (!result.error) {
          createdPost = result.data;
          break;
        }

        postFailure = result.error.message;
        if (hasAttachment && isMissingColumn(result.error)) attachmentUnsupported = true;
        console.warn(`[coins/feed-post] insert (${attempt.note}) failed:`, result.error.message);
      }
    } catch (cause) {
      postFailure = cause instanceof Error ? cause.message : "Feed post creation failed";
    }

    if (!createdPost) {
      await refund(postFailure || "unknown insert failure");

      /* The image was uploaded straight from the browser before this request, so
         a failed insert would otherwise leave it in Cloudinary with no row to
         ever expire it. */
      if (imagePath) {
        const cleanup = await destroyCloudinaryUrl(imagePath);
        if (!cleanup.ok) {
          console.error("[coins/feed-post] orphan photo cleanup failed:", cleanup.reason);
        }
      }

      if (attachmentUnsupported) {
        return NextResponse.json(
          {
            error: pollOptions
              ? "Polls aren't available on this server yet. You have not been charged."
              : "Photo whispers aren't available on this server yet. You have not been charged.",
          },
          { status: 503 }
        );
      }

      return NextResponse.json(
        {
          error: isReply
            ? "Couldn't post your reply. Please try again."
            : "Couldn't post that. You have not been charged.",
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      charged: cost,
      ...(cost > 0 ? { balance: balanceAfter } : {}),
      post: createdPost,
    });
  } catch (err) {
    console.error("[coins/feed-post] route error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
