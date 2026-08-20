import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

import { FEED_POST_COST, FEED_REPLY_COST } from "@/lib/coins";

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
 */

/** Shape of the row we insert. Loose because the optional columns depend on
 *  which migrations have been applied. */
type InsertBody = {
  author_id: string;
  body: string;
  whisper_link: string | null;
  parent_post_id?: string;
};

const BASE = "id,author_id,body,whisper_link,created_at,expires_at";

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

      const { data: postData, error: postError } = await supabaseAdmin
        .from("public_feed_posts")
        .insert([insertBody])
        .select(`${BASE},parent_post_id`)
        .single();

      if (!postError) {
        createdPost = postData;
      } else if (isReply) {
        /* `parent_post_id` is the newest column on this table. If the migration
           hasn't been applied, post the reply unthreaded rather than losing it —
           the text still reaches the feed. */
        console.warn("[coins/feed-post] threaded insert failed, retrying flat:", postError.message);
        delete insertBody.parent_post_id;

        const flat = await supabaseAdmin
          .from("public_feed_posts")
          .insert([insertBody])
          .select(BASE)
          .single();

        if (flat.error) postFailure = flat.error.message;
        else createdPost = flat.data;
      } else {
        postFailure = postError.message;
      }
    } catch (cause) {
      postFailure = cause instanceof Error ? cause.message : "Feed post creation failed";
    }

    if (!createdPost) {
      await refund(postFailure || "unknown insert failure");
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
