"use client";

/**
 * The emoji tab of the media picker: full Unicode set, category strip,
 * search, and recently-used — the same browsing model WhatsApp uses, drawn
 * from the device's own emoji font rather than anyone's proprietary artwork.
 *
 * Performance notes, because this renders ~1,900 buttons:
 *   - the dataset is a lazy dynamic import (~50KB JSON) that loads the first
 *     time the tab opens, not with the chat bundle;
 *   - each category section carries `content-visibility: auto`, so offscreen
 *     categories cost nothing to lay out or paint — native scrolling stays
 *     smooth on low-end Androids without a virtualization library;
 *   - category tracking is an IntersectionObserver on section headers, not a
 *     scroll listener.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import {
  loadEmojiCategories,
  searchEmojis,
  type EmojiCategory,
  type EmojiEntry,
} from "@/lib/emoji";
import { readRecentEmojis } from "@/lib/chatMedia";

const RECENT_ID = "recent";

export default function EmojiPanel({ onPick }: { onPick: (emoji: string) => void }) {
  const [categories, setCategories] = useState<EmojiCategory[] | null>(null);
  const [query, setQuery] = useState("");
  /* Lazy initializer — this component only renders client-side, after the
     picker opens, so reading localStorage here is safe and effect-free. */
  const [recents, setRecents] = useState<string[]>(() => readRecentEmojis());
  const [activeCategory, setActiveCategory] = useState<string>(RECENT_ID);
  const scrollRef = useRef<HTMLDivElement>(null);
  const sectionRefs = useRef<Map<string, HTMLElement>>(new Map());

  useEffect(() => {
    let cancelled = false;
    loadEmojiCategories().then((data) => {
      if (!cancelled) setCategories(data);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  /* Which section owns the viewport, for the strip's active indicator. */
  useEffect(() => {
    if (!categories) return;
    const container = scrollRef.current;
    if (!container) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const id = (entry.target as HTMLElement).dataset.category;
            if (id) setActiveCategory(id);
          }
        }
      },
      { root: container, rootMargin: "0px 0px -75% 0px" }
    );
    sectionRefs.current.forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, [categories, recents.length]);

  const hits = useMemo(
    () => (categories && query.trim() ? searchEmojis(categories, query) : null),
    [categories, query]
  );

  function jumpTo(id: string) {
    setActiveCategory(id);
    const node = sectionRefs.current.get(id);
    const container = scrollRef.current;
    if (!node || !container) return;
    container.scrollTop = node.offsetTop - 4;
  }

  function pick(emoji: string) {
    onPick(emoji);
    /* Local echo so the Recents row updates without a re-read. */
    setRecents((prev) => [emoji, ...prev.filter((e) => e !== emoji)].slice(0, 40));
  }

  const registerSection = useCallback(
    (id: string) => (node: HTMLElement | null) => {
      if (node) sectionRefs.current.set(id, node);
      else sectionRefs.current.delete(id);
    },
    []
  );

  if (!categories) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex gap-1.5" aria-label="Loading emojis">
          <span className="h-2 w-2 animate-bounce rounded-full bg-[var(--chat-meta)] [animation-delay:-0.2s]" />
          <span className="h-2 w-2 animate-bounce rounded-full bg-[var(--chat-meta)] [animation-delay:-0.1s]" />
          <span className="h-2 w-2 animate-bounce rounded-full bg-[var(--chat-meta)]" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Search */}
      <div className="shrink-0 px-3 pt-2">
        <div className="chat-field flex items-center gap-2 rounded-full px-3 py-1.5">
          <Search size={15} className="shrink-0 text-[var(--chat-meta)]" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search emoji"
            aria-label="Search emoji"
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-[var(--chat-meta)]"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Clear emoji search"
              className="chat-icon flex h-6 w-6 shrink-0 items-center justify-center rounded-full"
            >
              <X size={13} />
            </button>
          )}
        </div>
      </div>

      {hits ? (
        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3 pt-2">
          {hits.length === 0 ? (
            <p className="chat-meta mt-8 text-center text-sm">No emoji found for “{query.trim()}”</p>
          ) : (
            <EmojiGrid emojis={hits} onPick={pick} />
          )}
        </div>
      ) : (
        <>
          <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
            {recents.length > 0 && (
              <section ref={registerSection(RECENT_ID)} data-category={RECENT_ID}>
                <h3 className="chat-meta sticky top-0 z-10 bg-[var(--chat-chrome)] py-1.5 text-[11px] font-bold uppercase tracking-wider">
                  Recently used
                </h3>
                <EmojiGrid emojis={recents.map((e) => [e, e] as EmojiEntry)} onPick={pick} />
              </section>
            )}
            {categories.map((category) => (
              <section
                key={category.id}
                ref={registerSection(category.id)}
                data-category={category.id}
                className="emoji-section"
              >
                <h3 className="chat-meta sticky top-0 z-10 bg-[var(--chat-chrome)] py-1.5 text-[11px] font-bold uppercase tracking-wider">
                  {category.label}
                </h3>
                <EmojiGrid emojis={category.emojis} onPick={pick} />
              </section>
            ))}
          </div>

          {/* Category strip */}
          <div
            className="flex shrink-0 items-center gap-0.5 overflow-x-auto border-t px-2 py-1"
            style={{ borderColor: "var(--chat-chrome-bd)" }}
            role="tablist"
            aria-label="Emoji categories"
          >
            {recents.length > 0 && (
              <CategoryTab
                icon="🕘"
                label="Recently used"
                active={activeCategory === RECENT_ID}
                onClick={() => jumpTo(RECENT_ID)}
              />
            )}
            {categories.map((category) => (
              <CategoryTab
                key={category.id}
                icon={category.icon}
                label={category.label}
                active={activeCategory === category.id}
                onClick={() => jumpTo(category.id)}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function CategoryTab({
  icon,
  label,
  active,
  onClick,
}: {
  icon: string;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      aria-label={label}
      title={label}
      onClick={onClick}
      className={`flex h-9 min-w-9 shrink-0 items-center justify-center rounded-full text-base transition ${
        active ? "media-tab-active" : "opacity-55 hover:opacity-90"
      }`}
    >
      {icon}
    </button>
  );
}

function EmojiGrid({
  emojis,
  onPick,
}: {
  emojis: EmojiEntry[];
  onPick: (emoji: string) => void;
}) {
  return (
    <div className="emoji-grid">
      {emojis.map(([emoji, name], index) => (
        <button
          key={`${emoji}-${index}`}
          type="button"
          onClick={() => onPick(emoji)}
          aria-label={name}
          title={name}
          className="flex h-10 items-center justify-center rounded-lg text-[24px] leading-none transition hover:bg-[var(--chat-icon-hover)] active:scale-90"
        >
          {emoji}
        </button>
      ))}
    </div>
  );
}
