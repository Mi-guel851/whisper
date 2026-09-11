/**
 * The ambient word vocabulary.
 *
 * One list, shared by every morphing word wall in the app (the send page's
 * background and the dashboard welcome card). It exists as a module rather
 * than as four inline arrays per component for one reason: repetition. A wall
 * that cycles three or four words starts to feel like a screensaver inside a
 * minute — you read it, then you notice it repeating, and then it is noise
 * instead of texture. A hundred words at ~3.8s each is a cycle of six-plus
 * minutes, which is longer than almost anybody stares at one screen, so a
 * word that reappears reads as chance rather than as a loop.
 *
 * RULES THE LIST FOLLOWS
 *
 *  * Short. Every entry renders at display weight in a narrow column; the
 *    longest ones here are still single words or two-word phrases.
 *  * Lowercase in source. The CSS uppercases them, so casing is a styling
 *    decision and not a data one.
 *  * Whisper's voice, not a thesaurus. These are the words the product is
 *    actually about — anonymity, hesitation, the moment before sending —
 *    rather than a generic "calm words" list.
 *  * No literal rhymes of "whisper" (crisper, blister, lisper). They are
 *    comic, and these walls sit on the first screen a stranger sees.
 *
 * `whisperLane` is what makes several simultaneous lines safe: it slices the
 * list round-robin, so two lanes can never show the same word at the same
 * time no matter where they are in their cycles.
 */

export const WHISPER_WORDS: readonly string[] = [
  /* The brand's own four — kept first so any single-lane use opens on them. */
  "whisper",
  "softer",
  "closer",
  "quieter",
  "no name",
  "no trace",
  "no face",
  "say it",
  "send it",
  "mean it",
  "unsigned",
  "unseen",
  "unsaid",

  /* Honesty, which is the whole premise. */
  "honest",
  "truth",
  "secret",
  "hidden",
  "murmur",
  "mutter",
  "hush",
  "sigh",
  "confess",
  "admit",
  "reveal",
  "unmask",
  "off record",
  "real talk",
  "honestly",

  /* The hour these get sent. */
  "midnight",
  "moonlit",
  "dusk",
  "tonight",
  "someday",
  "almost",
  "finally",

  /* What the sender is hiding behind. */
  "shadow",
  "silhouette",
  "ghost",
  "veil",
  "mask",
  "nobody",
  "somebody",
  "stranger",

  /* Motion — the send, and the not-sending. */
  "echo",
  "ripple",
  "drift",
  "float",
  "linger",
  "hover",
  "fade",
  "bloom",
  "vanish",
  "dissolve",
  "melt",

  /* The nerve it takes. */
  "brave",
  "bold",
  "gentle",
  "tender",
  "heart",
  "pulse",
  "spark",
  "flame",
  "butterflies",
  "blush",
  "crush",

  /* The artefact itself. */
  "letter",
  "note",
  "line",
  "word",
  "typed",
  "deleted",
  "retyped",
  "sent",
  "paper",
  "ink",
  "fold",
  "seal",
  "one tap",
  "no reply",

  /* The hesitation, which is most of it. */
  "curious",
  "wondering",
  "thinking",
  "hoping",
  "maybe",
  "perhaps",
  "what if",
  "if only",
  "dear you",

  /* The promise the product makes. */
  "safe",
  "quiet",
  "private",
  "locked",
  "signal",
  "static",
  "tuned",
  "listen",
  "hear",
  "feel",
  "know",

  /* Weather and texture, so the wall is not all feelings. */
  "moon",
  "stars",
  "cloud",
  "rain",
  "soft",
  "warm",
  "still",
  "slow",
];

/**
 * One lane's cycle.
 *
 * Round-robin rather than chunked: slicing the list into contiguous blocks
 * would give each lane a single theme (one lane all hesitation, one all
 * weather), and the lanes change at different times, so a chunked wall would
 * visibly change subject every few seconds. Interleaved, every lane is a
 * cross-section of the whole list, which is what makes the wall read as one
 * vocabulary instead of three.
 *
 * Deterministic on purpose — no shuffle, no `Math.random()`. Server render and
 * client hydration must agree, and a wall that reshuffled on every visit would
 * be a different product each time.
 */
export function whisperLane(lane: number, laneCount: number, rotation = 0): string[] {
  const count = Math.max(1, Math.floor(laneCount));
  const index = ((lane % count) + count) % count;
  const words = WHISPER_WORDS.filter((_, position) => position % count === index);
  if (words.length < 2) return words;
  const offset = ((rotation % words.length) + words.length) % words.length;
  return [...words.slice(offset), ...words.slice(0, offset)];
}
