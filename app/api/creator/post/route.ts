import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

import { CLOUDINARY_FOLDERS, cloudinaryPublicId } from "@/lib/cloudinary";
import { cloudinaryImageExists, destroyCloudinaryUrl } from "@/lib/cloudinary.server";
import { consume, rateLimitedResponse } from "@/lib/apiGuard";
import { errorTextFor } from "@/lib/errorTextFor";

/**
 * Publishing an official Whisper creator post.
 *
 * Separate from /api/coins/feed-post on purpose: that route is the normal user
 * path and stays exactly as it is. This one has different rules — no coin
 * charge, no topic, no poll, and the row is written with
 * `author_role = 'whisper_creator'`.
 *
 * WHERE THE AUTHORISATION ACTUALLY HAPPENS
 *
 * Not here, and not from anything in the request body. The body is read for
 * `message`, `imagePath` and `imagePreview` only; `is_creator`, `verified`,
 * `author_role`, `role`, `official` and anything else a client sends are never
 * read at all. The decision is made twice, both times in Postgres:
 *
 *   1. `public.is_whisper_creator(auth.uid())` — called here with the *user's*
 *      JWT so `auth.uid()` is the real caller, and it compares the confirmed
 *      email on `auth.users` against `public.whisper_creator_emails`.
 *   2. `create_whisper_creator_post(...)` — the only sanctioned insert path —
 *      re-runs the same check, and the BEFORE INSERT trigger on
 *      `public_feed_posts` runs it a third time for any writer, including the
 *      service role. A forged request that somehow reached the table would
 *      still be refused.
 *
 * The Supabase service role is not used in this route at all. The insert runs
 * as the user, so RLS and the trigger both apply to it.
 */

const MAX_BODY = 500;
const MAX_PREVIEW_CHARS = 4000;

type RpcError = { code?: string; message?: string };

function isMissingSchema(error: RpcError | null) {
  if (!error) return false;
  if (error.code === "42883" || error.code === "PGRST202") return true;
  return /could not find the function|does not exist|schema cache/i.test(error.message ?? "");
}

export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    const accessToken = authHeader.slice("Bearer ".length);

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !anonKey) {
      console.error("[creator/post] Supabase environment variables are not set.");
      return NextResponse.json({ error: "Server not configured" }, { status: 500 });
    }

    /* A client bound to the caller's JWT. Every query below runs as that user,
       under RLS, with `auth.uid()` set — which is what makes the database's own
       creator check answer for the right person. */
    const asUser = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    });

    const {
      data: { user },
      error: userError,
    } = await asUser.auth.getUser(accessToken);

    if (userError || !user) {
      return NextResponse.json({ error: "Invalid session" }, { status: 401 });
    }

    /* Server-side check #1. The email is read by Postgres from auth.users, not
       from the token claims and not from the request. */
    const { data: isCreator, error: creatorError } = await asUser.rpc("is_whisper_creator");
    if (creatorError) {
      if (isMissingSchema(creatorError)) {
        return NextResponse.json(
          { error: "Official posts aren't set up on this server yet." },
          { status: 503 }
        );
      }
      console.error("[creator/post] is_whisper_creator failed:", creatorError.message);
      return NextResponse.json({ error: "Couldn't verify creator access." }, { status: 500 });
    }
    if (isCreator !== true) {
      return NextResponse.json(
        { error: "Only official Whisper creators can publish official posts." },
        { status: 403 }
      );
    }

    /* Official posts bypass the coin charge, so this rate limit is the only
       thing pacing them. Same budget as a normal author's posts. */
    const postGuard = await consume("creator-post", `u:${user.id}`, 6, 60_000);
    if (postGuard) return rateLimitedResponse(postGuard);

    /* ------------------------------------------------------------------
       Body. Only these three fields are ever read.
       ------------------------------------------------------------------ */

    const body = await req.json().catch(() => ({}));
    const text = String(body?.message || "").trim().slice(0, MAX_BODY);
    if (!text) {
      return NextResponse.json({ error: "Write something first" }, { status: 400 });
    }

    const imagePath =
      typeof body?.imagePath === "string" && body.imagePath ? body.imagePath : null;
    const imagePreview =
      typeof body?.imagePreview === "string" && body.imagePreview ? body.imagePreview : null;

    if (imagePath && !imagePreview) {
      return NextResponse.json(
        { error: "That photo couldn't be prepared. Please pick it again." },
        { status: 400 }
      );
    }
    if (imagePreview && imagePreview.length > MAX_PREVIEW_CHARS) {
      return NextResponse.json({ error: "That photo preview is too large." }, { status: 400 });
    }

    /* Same ownership and existence checks the normal route applies: the photo
       must live in this user's own Cloudinary folder and must actually exist. */
    if (imagePath) {
      const publicId = cloudinaryPublicId(imagePath);
      const expectedFolder = `${CLOUDINARY_FOLDERS.feedPhotos}/${user.id}/`;
      if (!publicId || !publicId.startsWith(expectedFolder) || publicId === expectedFolder) {
        return NextResponse.json({ error: "That photo isn't yours." }, { status: 403 });
      }
      if (!(await cloudinaryImageExists(imagePath))) {
        return NextResponse.json(
          { error: "That photo didn't finish uploading. Try again." },
          { status: 400 }
        );
      }
    }

    /* Server-side check #2 and #3 happen inside this call: the function refuses
       non-creators, and the table trigger refuses the role for non-creators. */
    const { data: post, error: insertError } = await asUser.rpc("create_whisper_creator_post", {
      p_body: text,
      p_image_path: imagePath,
      p_image_preview: imagePath ? imagePreview : null,
    });

    if (insertError || !post) {
      /* The browser uploaded the photo before this request; without a row to
         expire it, the asset would live forever. */
      if (imagePath) {
        const cleanup = await destroyCloudinaryUrl(imagePath);
        if (!cleanup.ok) {
          console.error("[creator/post] orphan photo cleanup failed:", cleanup.reason);
        }
      }

      if (insertError && isMissingSchema(insertError)) {
        return NextResponse.json(
          { error: "Official posts aren't set up on this server yet." },
          { status: 503 }
        );
      }
      if (insertError?.code === "42501") {
        return NextResponse.json(
          { error: "Only official Whisper creators can publish official posts." },
          { status: 403 }
        );
      }
      if (insertError?.code === "22023") {
        return NextResponse.json({ error: insertError.message }, { status: 400 });
      }

      /* Allowlisted admins (verified above via GoTrue) get the real insert
         error; everyone else gets the one sentence. */
      console.error("[creator/post] insert failed:", insertError?.message);
      return NextResponse.json(
        { error: errorTextFor(user, insertError, "Couldn't publish that. Please try again.") },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, post });
  } catch (err) {
    console.error("[creator/post] route error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
