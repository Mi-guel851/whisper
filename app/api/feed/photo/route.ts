import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isCloudinaryUrl } from "@/lib/cloudinary";
import { fetchCloudinaryImage } from "@/lib/cloudinary.server";

/**
 * Serves a feed photo, once per viewer.
 *
 * Why this route exists at all: the photo's real address is never given to a
 * browser. `public_feed_page` returns `has_image`, not `image_path`, so every
 * photo in the feed comes through here — which makes this the single place that
 * can decide whether this particular person still has a look left.
 *
 * How "once" differs from chat's view-once. A direct message has one recipient,
 * so `/api/photos/view` can destroy the image on first open and be done. A feed
 * post has thousands of viewers — destroying it for the first would break it for
 * everyone else. So the receipt is per viewer: a row in
 * `public_feed_post_image_views`, keyed `(post_id, viewer_id)`, and the image
 * outlives every individual view.
 *
 * Storage: `image_path` holds a Cloudinary delivery URL for posts written since
 * the migration and a `feed-photos` object key for older ones. Both are read.
 * Note what changed in the threat model — the old bucket was private, so no URL
 * existed at all; a Cloudinary URL is fetchable by anyone who obtains it, and
 * what keeps it unobtainable is that it stays server-side. That is why the bytes
 * are proxied here rather than redirected to.
 *
 * Ordering matters and mirrors the chat route deliberately: **read first,
 * record second.** A network failure fetching the bytes must not spend the
 * viewer's only look. And the response is only sent once the receipt is written,
 * so the reverse — a look that was never recorded — cannot happen either.
 */

export async function POST(req: NextRequest) {
  try {
    const { postId } = await req.json();
    if (!postId || typeof postId !== "string") {
      return NextResponse.json({ error: "Missing postId" }, { status: 400 });
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
      console.error("[feed/photo] Supabase environment variables are not set.");
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

    const { data: post, error: postError } = await supabaseAdmin
      .from("public_feed_posts")
      .select("id, author_id, image_path, expires_at")
      .eq("id", postId)
      .maybeSingle();

    if (postError || !post) {
      return NextResponse.json({ error: "Post not found" }, { status: 404 });
    }
    if (!post.image_path) {
      return NextResponse.json({ error: "No photo on this whisper" }, { status: 404 });
    }
    if (new Date(post.expires_at).getTime() <= Date.now()) {
      return NextResponse.json({ error: "This whisper has expired" }, { status: 410 });
    }

    const isAuthor = post.author_id === user.id;

    /* This route is directly callable, so the feed's blocking filter has to be
       enforced here too rather than only in the query that hides the post. Both
       directions, same as `public_feed_page`. */
    if (!isAuthor) {
      const { data: blocks } = await supabaseAdmin
        .from("blocked_users")
        .select("user_id")
        .or(
          `and(user_id.eq.${user.id},blocked_user_id.eq.${post.author_id}),` +
            `and(user_id.eq.${post.author_id},blocked_user_id.eq.${user.id})`
        )
        .limit(1);

      if (blocks && blocks.length > 0) {
        return NextResponse.json({ error: "Not available" }, { status: 403 });
      }

      /* Cheap pre-check so a spent photo costs one small query instead of a full
         download. The authoritative check is the insert below — this one can race,
         that one cannot. */
      const { data: existing } = await supabaseAdmin
        .from("public_feed_post_image_views")
        .select("post_id")
        .eq("post_id", postId)
        .eq("viewer_id", user.id)
        .maybeSingle();

      if (existing) {
        return NextResponse.json({ error: "You've already viewed this photo" }, { status: 410 });
      }
    }

    /* One shape either way: the bytes and the type the response will carry. */
    let bytes: ArrayBuffer;
    let contentType: string;

    if (isCloudinaryUrl(post.image_path)) {
      const image = await fetchCloudinaryImage(post.image_path);
      if (!image) {
        return NextResponse.json({ error: "Photo unavailable" }, { status: 404 });
      }
      bytes = image.bytes;
      contentType = image.contentType;
    } else {
      /* Legacy: a `feed-photos` object key from before the migration. */
      const { data: file, error: downloadError } = await supabaseAdmin.storage
        .from("feed-photos")
        .download(post.image_path);

      if (downloadError || !file) {
        console.error("[feed/photo] download failed:", downloadError?.message);
        return NextResponse.json({ error: "Photo unavailable" }, { status: 404 });
      }
      bytes = await file.arrayBuffer();
      contentType = file.type || "image/jpeg";
    }

    /**
     * Spend the view.
     *
     * A plain insert rather than an upsert-and-ignore, because the unique
     * violation is the answer: if two taps race, exactly one writes the receipt
     * and the other is told the photo is spent. An `ignoreDuplicates` upsert would
     * let both through, which is a second look however narrow the window.
     *
     * Authors are exempt and get no receipt written. Burning an author's single
     * view on their own post would mean they could never check what they posted,
     * and a receipt for the author is not a fact anyone needs.
     */
    if (!isAuthor) {
      const { error: viewError } = await supabaseAdmin
        .from("public_feed_post_image_views")
        .insert({ post_id: postId, viewer_id: user.id });

      if (viewError) {
        if (viewError.code === "23505") {
          return NextResponse.json({ error: "You've already viewed this photo" }, { status: 410 });
        }
        /* Serving without a receipt would make the photo permanently re-viewable,
           so this fails closed. */
        console.error("[feed/photo] could not record the view:", viewError.message);
        return NextResponse.json({ error: "Couldn't open that photo" }, { status: 500 });
      }
    }

    return new NextResponse(bytes, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        /* No caching anywhere. A cached response is a second view that never
           reaches this route. */
        "Cache-Control": "no-store, no-cache, must-revalidate",
        "Content-Length": String(bytes.byteLength),
      },
    });
  } catch (error) {
    console.error("[feed/photo] route error:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
