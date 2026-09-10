import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { consume, rateLimitedResponse } from "@/lib/apiGuard";
import { errorTextFor } from "@/lib/errorTextFor";

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

    /* Same budget as the primary feed route — this one is legacy, but it is
       reachable and it spends coins and writes to the feed. */
    const postGuard = await consume("feed-post", `u:${user.id}`, 6, 60_000);
    if (postGuard) return rateLimitedResponse(postGuard);

    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    /* The legacy reply route, kept so a stale client keeps working through a
       deploy. Its debit used to be a select/JS-subtract/write-back triple, which
       loses one of two concurrent spends; it now rides the same guarded, atomic
       `debit_whisper_coins` as the primary feed route, called under the caller's
       own JWT so the wallet it can touch is this user's and only this user's. */
    const COST = 2;

    const asUser = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { headers: { Authorization: `Bearer ${accessToken}` } },
      }
    );

    const { data: debited, error: debitError } = await asUser.rpc("debit_whisper_coins", {
      p_amount: COST,
      p_description: "Public reply",
    });

    if (debitError) {
      if (/insufficient/i.test(debitError.message)) {
        return NextResponse.json({ error: "Insufficient coins" }, { status: 402 });
      }
      console.error("[coins/reply] debit error:", debitError.message);
      return NextResponse.json({ error: "Failed to update balance" }, { status: 500 });
    }

    const newBalance = Number(debited ?? 0);

    /**
     * Create the public feed post.
     *
     * This is the part the user is actually paying for, so a failure here can't
     * be swallowed: it used to log and still return `success: true`, which
     * charged two coins for a reply that never appeared anywhere. Both the
     * balance and the transaction are rolled back before reporting the error.
     */
    async function refund(reason: string) {
      const { error: refundError } = await supabaseAdmin.rpc("refund_whisper_coins_for", {
        p_user_id: user!.id,
        p_amount: COST,
        p_description: "Refund: public reply failed",
      });
      if (refundError) {
        console.error("[coins/reply] refund RPC failed:", refundError.message);
        return false;
      }
      console.error("Reply refunded:", reason);
      return true;
    }

    type CreatedPost = {
      id: string;
      author_id: string;
      body: string;
      whisper_link: string | null;
      created_at: string;
      expires_at: string;
      parent_post_id?: string | null;
    };
    type InsertBody = {
      author_id: string;
      body: string;
      whisper_link: string | null;
      parent_post_id?: string;
    };

    let createdPost: CreatedPost | null = null;
    let postFailure = "";
    try {
      // attempt to look up the user's username for whisper_link
      const { data: profile } = await supabaseAdmin.from("profiles").select("username").eq("id", user.id).maybeSingle();
      const whisper_link = profile?.username ? `/u/${profile.username}` : null;

      const insertBody: InsertBody = {
        author_id: user.id,
        body: text,
        whisper_link,
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
      const refunded = await refund(postFailure || "unknown insert failure");
      if (!refunded) {
        return NextResponse.json(
          { error: "Posting failed and the refund could not be confirmed. Please contact support before retrying." },
          { status: 500 }
        );
      }
      /* Allowlisted admins (verified above via GoTrue) get the real insert
         failure; everyone else gets the one sentence. */
      return NextResponse.json(
        {
          error: errorTextFor(
            user,
            postFailure,
            "Couldn't post your reply. You have not been charged."
          ),
        },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, balance: newBalance, post: createdPost });
  } catch (err) {
    console.error("Reply route error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
