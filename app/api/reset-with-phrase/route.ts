import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { supabaseAdmin } from "@/lib/supabase/admin";

export async function POST(req: NextRequest) {
  const { username, phrase, newPassword } = await req.json();

  if (!username || !phrase || !newPassword || newPassword.length < 6) {
    return NextResponse.json({ error: "Missing or invalid fields." }, { status: 400 });
  }

  const cleanUsername = username.trim().toLowerCase();

  const { data: profile, error: findError } = await supabaseAdmin
    .from("profiles")
    .select("id, recovery_phrase_hash")
    .eq("username", cleanUsername)
    .maybeSingle();

  if (findError || !profile || !profile.recovery_phrase_hash) {
    return NextResponse.json({ error: "Invalid username or recovery phrase." }, { status: 400 });
  }

  const matches = await bcrypt.compare(phrase.trim(), profile.recovery_phrase_hash);

  if (!matches) {
    return NextResponse.json({ error: "Invalid username or recovery phrase." }, { status: 400 });
  }

  const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(profile.id, {
    password: newPassword,
  });

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}