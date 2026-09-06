/**
 * The full Unicode emoji set, organised the way WhatsApp organises it.
 *
 * `data.json` is generated from `unicode-emoji-json` (CC0 metadata over the
 * Unicode CLDR data): every emoji up to Emoji 15.1, grouped in CLDR order —
 * Smileys & Emotion, People & Body, Animals & Nature, Food & Drink,
 * Travel & Places, Activities, Objects, Symbols, Flags — with its English
 * name kept for search. The glyphs themselves render from the device's own
 * emoji font, which is exactly what the platform's WhatsApp does too.
 *
 * The JSON is ~50KB, so it is loaded lazily (dynamic import) the first time
 * the picker opens rather than riding along in the chat bundle.
 */

export type EmojiEntry = [emoji: string, name: string];

export type EmojiGroup = {
  name: string;
  emojis: EmojiEntry[];
};

export type EmojiCategory = {
  id: string;
  /** Short label for the category strip. */
  label: string;
  /** The glyph that fronts the category tab. */
  icon: string;
  emojis: EmojiEntry[];
};

/** Display metadata per CLDR group, in the order the strip shows them. */
const CATEGORY_META: Record<string, { id: string; label: string; icon: string }> = {
  "Smileys & Emotion": { id: "smileys", label: "Smileys & Emotion", icon: "😀" },
  "People & Body": { id: "people", label: "People", icon: "👋" },
  "Animals & Nature": { id: "nature", label: "Animals & Nature", icon: "🐻" },
  "Food & Drink": { id: "food", label: "Food & Drink", icon: "🍔" },
  "Travel & Places": { id: "travel", label: "Travel & Places", icon: "✈️" },
  "Activities": { id: "activities", label: "Activities", icon: "⚽" },
  "Objects": { id: "objects", label: "Objects", icon: "💡" },
  "Symbols": { id: "symbols", label: "Symbols", icon: "❤️" },
  "Flags": { id: "flags", label: "Flags", icon: "🏳️" },
};

let cache: EmojiCategory[] | null = null;

export async function loadEmojiCategories(): Promise<EmojiCategory[]> {
  if (cache) return cache;
  const raw = (await import("./data.json")).default as EmojiGroup[];
  cache = raw
    .filter((group) => CATEGORY_META[group.name])
    .map((group) => ({ ...CATEGORY_META[group.name], emojis: group.emojis }));
  return cache;
}

/** Case-insensitive substring search over emoji names, capped for the DOM. */
export function searchEmojis(
  categories: EmojiCategory[],
  query: string,
  cap = 120
): EmojiEntry[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const hits: EmojiEntry[] = [];
  for (const category of categories) {
    for (const entry of category.emojis) {
      if (entry[1].includes(needle)) {
        hits.push(entry);
        if (hits.length >= cap) return hits;
      }
    }
  }
  return hits;
}
