import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const text = String(body?.message || "").slice(0, 1000);

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

    // Create a public feed post so the reply is visible in the Public Feed.
    let createdPost: any = null;
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

      const { data: postData, error: postError } = await supabaseAdmin
        .from("public_feed_posts")
        .insert([insertBody])
        .select("id,author_id,body,whisper_link,created_at,expires_at,parent_post_id")
        .single();

      if (postError) {
        console.error("Public post insert error:", postError.message);
      } else {
        createdPost = postData;
      }
    } catch (e) {
      console.error("Public post creation failed:", e);
    }

    return NextResponse.json({ success: true, balance: newBalance, post: createdPost });
  } catch (err) {
    console.error("Reply route error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
