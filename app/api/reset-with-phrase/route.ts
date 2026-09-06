import { NextRequest, NextResponse } from "next/server";
import { verifyRecoveryPhrase } from "@/lib/recoveryPhrase";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { clientIp, consume, consumeMulti, rateLimitedResponse } from "@/lib/apiGuard";

/**
 * Password reset by recovery phrase — the no-email path.
 *
 * WHAT THE ENDPOINT PROVES
 *
 * Knowledge of (username, phrase) is the credential. The phrase is checked
 * against the PBKDF2 hash stored on the profile; a failure answers with the
 * exact same message whether the username is wrong, the phrase is wrong, or no
 * phrase was ever set, so the endpoint is not an existence oracle.
 *
 * WHY THE LIMITS HERE MATTER
 *
 * This is the only endpoint in the app where the answer is "you now own this
 * account", so it gets the tightest budget: attempts are bucketed by IP, by
 * IP+username, and — while an attacker grinds one account from many IPs — the
 * per-username bucket still throttles them. The 429 body is deliberately
 * identical in shape to every other rate limit in the app.
 *
 * The per-attempt PBKDF2 cost (210k iterations) is on purpose too: it makes
 * offline-speed guessing impossible against this endpoint even if the limiter
 * is soaked through.
 */

/** Same grammar the signup form enforces; a mismatch here only rejects garbage. */
const USERNAME_RE = /^[a-z0-9_]{3,20}$/;

/** Generic failure answer shared by every rejection path on purpose. */
const INVALID = { error: "Invalid username or recovery phrase." };

export async function POST(req: NextRequest) {
  try {
    const ip = clientIp(req.headers);

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Malformed request." }, { status: 400 });
    }

    const raw = (body ?? {}) as Record<string, unknown>;
    const username = typeof raw.username === "string" ? raw.username.trim().toLowerCase().slice(0, 64) : "";
    const phrase = typeof raw.phrase === "string" ? raw.phrase.trim().slice(0, 256) : "";
    const newPassword = typeof raw.newPassword === "string" ? raw.newPassword : "";

    /* Bucket the *attempt* before any database work, so even requests for
       nonexistent users cost the attacker their quota. */
    const byIp = consume("reset-phrase:ip", ip, 8, 10 * 60_000);
    if (byIp) return rateLimitedResponse(byIp);

    if (!USERNAME_RE.test(username) || !phrase) {
      /* Answer, don't describe: shape is the same as every invalid attempt. */
      return NextResponse.json(INVALID, { status: 400 });
    }

    const perTarget = consumeMulti("reset-phrase:target", [ip, `u:${username}`], 4, 15 * 60_000);
    if (perTarget) return rateLimitedResponse(perTarget);

    if (newPassword.length < 8 || newPassword.length > 256) {
      return NextResponse.json(
        { error: "New password must be at least 8 characters." },
        { status: 400 }
      );
    }

    const supabaseAdmin = getSupabaseAdmin();

    const { data: profile, error: findError } = await supabaseAdmin
      .from("profiles")
      .select("id, recovery_phrase_hash")
      .eq("username", username)
      .maybeSingle();

    if (findError) console.error("[reset-with-phrase] lookup failed:", findError.message);

    if (findError || !profile || !profile.recovery_phrase_hash) {
      return NextResponse.json(INVALID, { status: 400 });
    }

    const matches = await verifyRecoveryPhrase(phrase, profile.recovery_phrase_hash);
    if (!matches) {
      return NextResponse.json(INVALID, { status: 400 });
    }

    const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(profile.id, {
      password: newPassword,
    });

    if (updateError) {
      /* The gotrue message can mention internal constraints; the client gets a
         generic answer, the log gets the detail. */
      console.error("[reset-with-phrase] password update failed:", updateError.message);
      return NextResponse.json({ error: "Couldn't reset the password. Please try again." }, { status: 500 });
    }

    /* A password change is the moment a stolen session should die. Gotrue's
       behavior on admin updates varies by version, so say the requirement out
       loud in the log line: if sessions survive this, the dashboard setting
       (Auth → "terminate existing sessions on password change" or an equivalent
       revocation call) has to close the gap. */
    console.warn(
      `[reset-with-phrase] password changed for user ${profile.id} — verify existing sessions/refresh tokens were invalidated`
    );

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[reset-with-phrase]", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
