import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    /* The table caps a body at 500 characters. Accepting 1000 here meant a long
       reply passed validation, took the coins, and was then rejected by the
       insert — the user paid for a post that never appeared. */
    const text = String(body?.message || "").trim().slice(0, 500);
    if (!text) {
      return NextResponse.json({ error: "Write a reply first" }, { status: 400 });
    }

    const authHeader = req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    const accessToken = authHeader.replace("Bearer ", "");

    const supabaseAuth = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );

    const {
      data: { user },
      error: userError,
    } = await supabaseAuth.auth.getUser(accessToken);

    if (userError || !user) {
      return NextResponse.json({ error: "Invalid session" }, { status: 401 });
    }

    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Read current balance
    const { data: wallet, error: walletError } = await supabaseAdmin
      .from("coins")
      .select("balance")
      .eq("user_id", user.id)
      .maybeSingle();

    if (walletError) {
      console.error("Wallet read error:", walletError.message);
      return NextResponse.json({ error: "Failed to read wallet" }, { status: 500 });
    }

    const balance = (wallet && (wallet as any).balance) ?? 0;
    const COST = 2;
    if (balance < COST) {
      return NextResponse.json({ error: "Insufficient coins" }, { status: 402 });
    }

    // Deduct and record transaction
    const newBalance = balance - COST;

    const { error: updateError } = await supabaseAdmin
      .from("coins")
      .update({ balance: newBalance })
      .eq("user_id", user.id);

    if (updateError) {
      console.error("Balance update error:", updateError.message);
      return NextResponse.json({ error: "Failed to update balance" }, { status: 500 });
    }

    const { error: insertError } = await supabaseAdmin.from("coin_transactions").insert([
      {
        user_id: user.id,
        amount: -COST,
        description: "Public reply",
        transaction_type: "spend",
      },
    ]);

    if (insertError) {
      console.error("Transaction insert error:", insertError.message);
      // best-effort: try to roll back balance (ignore failure)
      await supabaseAdmin.from("coins").update({ balance }).eq("user_id", user.id);
      return NextResponse.json({ error: "Failed to record transaction" }, { status: 500 });
    }

    /**
     * Create the public feed post.
     *
     * This is the part the user is actually paying for, so a failure here can't
     * be swallowed: it used to log and still return `success: true`, which
     * charged two coins for a reply that never appeared anywhere. Both the
     * balance and the transaction are rolled back before reporting the error.
     */
    async function refund(reason: string) {
      await supabaseAdmin.from("coins").update({ balance }).eq("user_id", user!.id);
      await supabaseAdmin.from("coin_transactions").insert([
        {
          user_id: user!.id,
          amount: COST,
          description: "Refund: public reply failed",
          transaction_type: "refund",
        },
      ]);
      console.error("Reply refunded:", reason);
    }

    let createdPost: any = null;
    let postFailure = "";
    try {
      // attempt to look up the user's username for whisper_link
      const { data: profile } = await supabaseAdmin.from("profiles").select("username").eq("id", user.id).maybeSingle();
      const whisper_link = profile?.username ? `/u/${profile.username}` : null;

      const insertBody: any = {
        author_id: user.id,
        body: text,
        whisper_link: whisper_link,
      };
      // allow optional parent post id for replies
      if (body?.postId) insertBody.parent_post_id = body.postId;

      const BASE = "id,author_id,body,whisper_link,created_at,expires_at";

      const { data: postData, error: postError } = await supabaseAdmin
        .from("public_feed_posts")
        .insert([insertBody])
        .select(`${BASE},parent_post_id`)
        .single();

      if (!postError) {
        createdPost = postData;
      } else if (insertBody.parent_post_id) {
        /* `parent_post_id` is the newest column on this table. If the migration
           hasn't been applied, post the reply unthreaded rather than taking the
           coins and returning nothing — the text still reaches the feed. */
        console.warn("Threaded reply insert failed, retrying flat:", postError.message);
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
    } catch (e) {
      postFailure = e instanceof Error ? e.message : "Public post creation failed";
    }

    if (!createdPost) {
      await refund(postFailure || "unknown insert failure");
      return NextResponse.json(
        { error: "Couldn't post your reply. You have not been charged." },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, balance: newBalance, post: createdPost });
  } catch (err) {
    console.error("Reply route error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
