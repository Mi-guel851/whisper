import { NextRequest, NextResponse } from "next/server";

/**
 * GIF search/trending proxy.
 *
 * The browser never talks to the GIF provider and never sees the API key —
 * this route is the only holder of `TENOR_API_KEY` / `GIPHY_API_KEY`. Set
 * either one (Tenor is preferred when both exist) and the GIF tab lights up;
 * set neither and the tab renders its "not configured" empty state instead of
 * erroring.
 *
 * The response is normalized to one shape for both providers:
 *   { results: [{ id, title, previewUrl, url, width, height }], next }
 *
 * `url` is deliberately the provider's *small* rendition (Tenor `tinygif`,
 * GIPHY `fixed_height_small`) rather than the full-size GIF: the client
 * re-hosts that rendition into Cloudinary at send time, so what gets stored
 * and delivered is tens-of-KB, not megabytes. `previewUrl` is smaller still,
 * for the picker grid.
 */

export const dynamic = "force-dynamic";

const PAGE_SIZE = 24;

type NormalizedGif = {
  id: string;
  title: string;
  previewUrl: string;
  url: string;
  width: number;
  height: number;
};

function bad(status: number, error: string) {
  return NextResponse.json({ error }, { status });
}

async function searchTenor(key: string, q: string | null, pos: string | null) {
  const params = new URLSearchParams({
    key,
    limit: String(PAGE_SIZE),
    media_filter: "tinygif,nanogif",
    contentfilter: "medium",
  });
  if (pos) params.set("pos", pos);
  const endpoint = q
    ? (params.set("q", q), `https://tenor.googleapis.com/v2/search?${params}`)
    : `https://tenor.googleapis.com/v2/featured?${params}`;

  const response = await fetch(endpoint, { cache: "no-store" });
  if (!response.ok) throw new Error(`Tenor ${response.status}`);
  const payload = await response.json();

  type TenorFormat = { url?: string; dims?: number[] };
  type TenorItem = {
    id?: string | number;
    content_description?: string;
    media_formats?: { tinygif?: TenorFormat; nanogif?: TenorFormat };
  };

  const results: NormalizedGif[] = ((payload.results || []) as TenorItem[]).flatMap(
    (item): NormalizedGif[] => {
      const tiny = item.media_formats?.tinygif;
      const nano = item.media_formats?.nanogif || tiny;
      if (!tiny?.url || !nano?.url) return [];
      return [
        {
          id: String(item.id),
          title: String(item.content_description || ""),
          previewUrl: String(nano.url),
          url: String(tiny.url),
          width: Number(tiny.dims?.[0] || 220),
          height: Number(tiny.dims?.[1] || 220),
        },
      ];
    }
  );

  return { results, next: payload.next ? String(payload.next) : null };
}

async function searchGiphy(key: string, q: string | null, pos: string | null) {
  const offset = pos ? Math.max(0, parseInt(pos, 10) || 0) : 0;
  const params = new URLSearchParams({
    api_key: key,
    limit: String(PAGE_SIZE),
    offset: String(offset),
    rating: "pg-13",
  });
  const endpoint = q
    ? (params.set("q", q), `https://api.giphy.com/v1/gifs/search?${params}`)
    : `https://api.giphy.com/v1/gifs/trending?${params}`;

  const response = await fetch(endpoint, { cache: "no-store" });
  if (!response.ok) throw new Error(`GIPHY ${response.status}`);
  const payload = await response.json();

  type GiphyRendition = { url?: string; width?: string; height?: string };
  type GiphyItem = {
    id?: string;
    title?: string;
    images?: {
      fixed_height_small?: GiphyRendition;
      fixed_height_small_still?: GiphyRendition;
      preview_gif?: GiphyRendition;
    };
  };

  const results: NormalizedGif[] = ((payload.data || []) as GiphyItem[]).flatMap(
    (item): NormalizedGif[] => {
      const small = item.images?.fixed_height_small;
      const preview =
        item.images?.preview_gif || item.images?.fixed_height_small_still || small;
      if (!small?.url || !preview?.url) return [];
      return [
        {
          id: String(item.id),
          title: String(item.title || ""),
          previewUrl: String(preview.url),
          url: String(small.url),
          width: Number(small.width || 220),
          height: Number(small.height || 220),
        },
      ];
    }
  );

  const total = Number(payload.pagination?.total_count ?? 0);
  const nextOffset = offset + PAGE_SIZE;
  return { results, next: nextOffset < total ? String(nextOffset) : null };
}

export async function GET(req: NextRequest) {
  const tenorKey = process.env.TENOR_API_KEY;
  const giphyKey = process.env.GIPHY_API_KEY;

  if (!tenorKey && !giphyKey) {
    /* 501, and the client shows a setup message rather than a failure one. */
    return bad(501, "GIF search isn't configured on this server yet.");
  }

  const q = req.nextUrl.searchParams.get("q")?.trim().slice(0, 80) || null;
  const pos = req.nextUrl.searchParams.get("pos")?.slice(0, 40) || null;

  try {
    const page = tenorKey
      ? await searchTenor(tenorKey, q, pos)
      : await searchGiphy(giphyKey!, q, pos);
    return NextResponse.json(page, {
      /* Trending pages are identical for everyone for minutes at a time. */
      headers: { "Cache-Control": q ? "no-store" : "public, max-age=120" },
    });
  } catch (error) {
    console.error("[gifs] provider error:", error);
    return bad(502, "The GIF service didn't answer. Try again in a moment.");
  }
}
