import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { hashRecoveryPhrase } from "@/lib/recoveryPhrase";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { clientIp, consume, rateLimitedResponse } from "@/lib/apiGuard";

/**
 * Stores the account's recovery phrase hash.
 *
 * WHO THE USER IS, AND WHY THAT CHANGED
 *
 * This route used to take `userId` straight from the request body with no
 * authentication at all. That was an account-takeover primitive: `profiles.id`
 * is readable by anyone (the public profile pages need it), so any visitor
 * could POST `{ userId: <victim>, phrase: "attack" }`, overwrite the victim's
 * hash, and then walk through /api/reset-with-phrase to set a new password.
 *
 * Identity is now derived exclusively from the Bearer token — a valid Supabase
 * JWT verified server-side with `auth.getUser()`. The body's `userId` is not
 * read at any point; the hash is written for whoever the token belongs to and
 * nobody else. A caller who cannot present a session cannot touch a row.
 *
 * The phrase itself never leaves here in the clear: it is PBKDF2-hashed before
 * it touches the database, and neither the phrase nor the hash is logged.
 */

const MIN_PHRASE_CHARS = 8;

export async function POST(req: NextRequest) {
  try {
    /* One hash per attempt costs ~210k PBKDF2 rounds. Without this guard a
       scripted caller turns that into a free CPU burn on every instance. */
    const limited = await consume("set-recovery-phrase", clientIp(req.headers), 5, 10 * 60_000);
    if (limited) return rateLimitedResponse(limited);

    const authHeader = req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    const accessToken = authHeader.slice("Bearer ".length);

    const supabaseAuth = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } }
    );
    const {
      data: { user },
      error: userError,
    } = await supabaseAuth.auth.getUser(accessToken);

    if (userError || !user) {
      return NextResponse.json({ error: "Invalid session" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const phrase = typeof body?.phrase === "string" ? body.phrase.trim() : "";

    /* 8, not 6: this value is a password-equivalent — the whole reset flow
       trusts it — and a 6-character phrase is guessable by hand. */
    if (phrase.length < MIN_PHRASE_CHARS || phrase.length > 256) {
      return NextResponse.json(
        { error: `Recovery phrase must be between ${MIN_PHRASE_CHARS} and 256 characters.` },
        { status: 400 }
      );
    }

    const hash = await hashRecoveryPhrase(phrase);
    const supabaseAdmin = getSupabaseAdmin();

    const { error } = await supabaseAdmin
      .from("profiles")
      .update({ recovery_phrase_hash: hash })
      .eq("id", user.id);

    if (error) {
      console.error("[set-recovery-phrase] update failed:", error.message);
      return NextResponse.json({ error: "Couldn't save your recovery phrase. Please try again." }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[set-recovery-phrase]", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
