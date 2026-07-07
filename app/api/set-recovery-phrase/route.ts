import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { supabaseAdmin } from "@/lib/supabase/admin";

export async function POST(req: NextRequest) {
  const { userId, phrase } = await req.json();

  if (!userId || !phrase || phrase.trim().length < 6) {
    return NextResponse.json(
      { error: "Recovery phrase must be at least 6 characters." },
      { status: 400 }
    );
  }

  const hash = await bcrypt.hash(phrase.trim(), 10);

  const { error } = await supabaseAdmin
    .from("profiles")
    .update({ recovery_phrase_hash: hash })
    .eq("id", userId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}