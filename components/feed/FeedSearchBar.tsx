"use client";

import { memo, useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { vibrate, HAPTIC } from "@/lib/haptics";

/**
 * Feed search.
 *
 * The debounce lives here rather than in the page for one reason: a search term
 * is a *query parameter*, and every keystroke that reaches the page resets
 * pagination and refires the RPC. Holding the draft locally means typing costs
 * nothing until it stops.
 *
 * 320ms is chosen against thumb typing, not desktop typing — long enough that a
 * word lands as one query on a phone, short enough that the feed still feels
 * like it's answering.
 */

const DEBOUNCE_MS = 320;

type FeedSearchBarProps = {
  /** The committed term the feed is currently filtered by. */
  value: string;
  onSearch: (term: string) => void;
};

function FeedSearchBarBase({ value, onSearch }: FeedSearchBarProps) {
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  /* Follows an external reset — clearing the feed's filters from elsewhere has
     to empty the box too, or the field claims a filter that isn't applied. */
  const committed = useRef(value);
  useEffect(() => {
    if (value !== committed.current) {
      committed.current = value;
      setDraft(value);
    }
  }, [value]);

  useEffect(() => {
    const term = draft.trim();
    if (term === committed.current) return;

    const timer = setTimeout(() => {
      committed.current = term;
      onSearch(term);
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [draft, onSearch]);

  return (
    <div className="feed-search">
      <Search size={15} aria-hidden className="feed-search-icon" />
      <input
        ref={inputRef}
        type="search"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            /* Commit immediately — someone who presses Enter has finished
               typing, and waiting out the debounce after that reads as lag. */
            const term = draft.trim();
            committed.current = term;
            onSearch(term);
            inputRef.current?.blur();
          }
          if (event.key === "Escape") setDraft("");
        }}
        placeholder="Search whispers"
        aria-label="Search whispers"
        /* Suggestions and autocorrect are wrong for a search field over other
           people's words — the term is often a name or a fragment, not prose. */
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="search"
        className="feed-search-input"
      />
      {draft.length > 0 && (
        <button
          type="button"
          onClick={() => {
            vibrate(HAPTIC.tap);
            setDraft("");
            committed.current = "";
            onSearch("");
            inputRef.current?.focus();
          }}
          aria-label="Clear search"
          className="feed-search-clear"
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
}

export const FeedSearchBar = memo(FeedSearchBarBase);
export default FeedSearchBar;
