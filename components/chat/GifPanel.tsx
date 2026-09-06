"use client";

/**
 * The GIF tab: trending on open, search with debounce, category chips,
 * paginated "load more", and the full set of states — loading, empty, error,
 * and "provider not configured".
 *
 * All provider traffic goes through /api/gifs; no API key ever reaches this
 * component. Selecting a GIF hands the small rendition URL up to the chat
 * page, which re-hosts it into Cloudinary and inserts the message.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Search, X, RefreshCw, Clapperboard } from "lucide-react";
import { GIF_CATEGORIES, type GifPage, type GifResult } from "@/lib/chatMedia";

type Status = "loading" | "ready" | "error" | "unconfigured";

export default function GifPanel({
  onPick,
  sending,
}: {
  onPick: (gif: GifResult) => void;
  /** URL of the GIF currently being re-hosted/sent, for its spinner. */
  sending: string | null;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GifResult[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [errorText, setErrorText] = useState("");
  const [loadingMore, setLoadingMore] = useState(false);
  const requestId = useRef(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchPage = useCallback(async (q: string, pos: string | null) => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (pos) params.set("pos", pos);
    const response = await fetch(`/api/gifs?${params}`);
    if (response.status === 501) throw new Error("__unconfigured__");
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || "Couldn't load GIFs.");
    }
    return (await response.json()) as GifPage;
  }, []);

  const load = useCallback(
    async (q: string) => {
      const id = ++requestId.current;
      setStatus("loading");
      try {
        const page = await fetchPage(q, null);
        if (id !== requestId.current) return;
        setResults(page.results);
        setNext(page.next);
        setStatus("ready");
      } catch (error) {
        if (id !== requestId.current) return;
        if (error instanceof Error && error.message === "__unconfigured__") {
          setStatus("unconfigured");
        } else {
          setErrorText(error instanceof Error ? error.message : "Couldn't load GIFs.");
          setStatus("error");
        }
      }
    },
    [fetchPage]
  );

  /* Trending on mount. Deferred a tick so the effect body itself stays
     setState-free (react-hooks/set-state-in-effect). */
  useEffect(() => {
    const timer = setTimeout(() => void load(""), 0);
    return () => clearTimeout(timer);
  }, [load]);

  /* Debounced search. */
  function handleQueryChange(value: string) {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => void load(value.trim()), 350);
  }

  function pickCategory(label: string) {
    /* Strip the emoji prefix — the provider searches the word. */
    const term = label.replace(/^\S+\s/, "");
    setQuery(term);
    void load(term);
  }

  async function loadMore() {
    if (!next || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await fetchPage(query.trim(), next);
      setResults((prev) => [...prev, ...page.results]);
      setNext(page.next);
    } catch {
      /* A failed "more" is not worth an error state over results already
         on screen; the button stays and can be tapped again. */
    } finally {
      setLoadingMore(false);
    }
  }

  if (status === "unconfigured") {
    return (
      <EmptyShell icon={<Clapperboard size={28} />}>
        <p className="text-sm font-bold">GIFs aren&apos;t set up yet</p>
        <p className="chat-meta mt-1 max-w-[240px] text-xs">
          Add a Tenor or GIPHY API key on the server to turn on GIF search.
        </p>
      </EmptyShell>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 px-3 pt-2">
        <div className="chat-field flex items-center gap-2 rounded-full px-3 py-1.5">
          <Search size={15} className="shrink-0 text-[var(--chat-meta)]" />
          <input
            value={query}
            onChange={(e) => handleQueryChange(e.target.value)}
            placeholder="Search GIFs"
            aria-label="Search GIFs"
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-[var(--chat-meta)]"
          />
          {query && (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                void load("");
              }}
              aria-label="Clear GIF search"
              className="chat-icon flex h-6 w-6 shrink-0 items-center justify-center rounded-full"
            >
              <X size={13} />
            </button>
          )}
        </div>
        {/* Category chips */}
        <div className="mt-2 flex gap-1.5 overflow-x-auto pb-0.5">
          {GIF_CATEGORIES.map((label) => (
            <button
              key={label}
              type="button"
              onClick={() => pickCategory(label)}
              className="chat-field shrink-0 rounded-full px-3 py-1 text-xs font-semibold transition hover:opacity-80 active:scale-95"
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-2 min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        {status === "loading" ? (
          <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4">
            {Array.from({ length: 12 }).map((_, i) => (
              <div key={i} className="skeleton aspect-video rounded-lg" aria-hidden />
            ))}
          </div>
        ) : status === "error" ? (
          <EmptyShell icon={<Clapperboard size={28} />}>
            <p className="text-sm font-bold">Something went wrong</p>
            <p className="chat-meta mt-1 max-w-[240px] text-xs">{errorText}</p>
            <button
              type="button"
              onClick={() => void load(query.trim())}
              className="chat-field mt-3 inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-xs font-bold"
            >
              <RefreshCw size={12} /> Try again
            </button>
          </EmptyShell>
        ) : results.length === 0 ? (
          <EmptyShell icon={<Clapperboard size={28} />}>
            <p className="text-sm font-bold">No GIFs found</p>
            <p className="chat-meta mt-1 text-xs">Try a different search.</p>
          </EmptyShell>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4">
              {results.map((gif) => {
                const isSending = sending === gif.url;
                return (
                  <button
                    key={gif.id}
                    type="button"
                    onClick={() => onPick(gif)}
                    disabled={Boolean(sending)}
                    aria-label={gif.title ? `Send GIF: ${gif.title}` : "Send GIF"}
                    className="relative overflow-hidden rounded-lg bg-[var(--chat-field)] transition active:scale-95 disabled:opacity-70"
                    style={{ aspectRatio: `${gif.width} / ${gif.height}` }}
                  >
                    {/* Plain <img>: these are animated GIFs from an allowlisted
                        CDN; next/image would only add a proxy hop. */}
                    <img
                      src={gif.previewUrl}
                      alt={gif.title}
                      loading="lazy"
                      decoding="async"
                      className="h-full w-full object-cover"
                    />
                    {isSending && (
                      <span className="absolute inset-0 flex items-center justify-center bg-black/50">
                        <span className="h-5 w-5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            {next && (
              <button
                type="button"
                onClick={() => void loadMore()}
                disabled={loadingMore}
                className="chat-field mx-auto mt-3 flex items-center gap-2 rounded-full px-5 py-2 text-xs font-bold disabled:opacity-60"
              >
                {loadingMore ? (
                  <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                ) : null}
                {loadingMore ? "Loading…" : "Load more"}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function EmptyShell({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-6 py-8 text-center">
      <div className="empty-medallion mb-3 !h-14 !w-14">{icon}</div>
      {children}
    </div>
  );
}
