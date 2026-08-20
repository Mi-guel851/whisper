/**
 * Daily Whisper — the prompt that changes every day, and the pool the prompt
 * generator draws from.
 *
 * WHY THERE IS NO DATABASE TABLE HERE
 *
 * A daily prompt looks like it needs storage — a `daily_prompts` table, a cron
 * job to pick tomorrow's, a row per day. It doesn't. The prompt is a pure
 * function of the date, so every user sees the same prompt on the same day
 * without a single row being written or read. That matters for more than
 * simplicity: it means the feature works on first paint with no request, it
 * cannot be broken by an unapplied migration, and two people comparing their
 * Whisper on the same afternoon see the same question — which is what makes it
 * feel like a shared moment rather than a random string.
 *
 * The trade-off is that changing the pool shifts which prompt lands on which
 * day. That is fine for prompts. It would not be fine for anything a user could
 * have bookmarked.
 */

export type PromptCategory =
  | "funny"
  | "deep"
  | "romantic"
  | "savage"
  | "friendship"
  | "school"
  | "work"
  | "random";

export type WhisperPrompt = {
  /** Stable id, so a prompt can be referenced without depending on its index. */
  id: string;
  text: string;
  category: PromptCategory;
};

/** Display labels and the accent each category carries in the UI. */
export const PROMPT_CATEGORIES: {
  key: PromptCategory;
  label: string;
  emoji: string;
}[] = [
  { key: "random", label: "Random", emoji: "🎲" },
  { key: "funny", label: "Funny", emoji: "😂" },
  { key: "deep", label: "Deep", emoji: "🌙" },
  { key: "romantic", label: "Romantic", emoji: "💫" },
  { key: "savage", label: "Savage", emoji: "🔥" },
  { key: "friendship", label: "Friends", emoji: "🤝" },
  { key: "school", label: "School", emoji: "🎓" },
  { key: "work", label: "Work", emoji: "💼" },
];

/**
 * The pool.
 *
 * Written in the second person and aimed at the *sender*, because that is who
 * reads it: the prompt travels with a shared link and is the first thing a
 * visitor sees on the send page. "What's your first impression of me?" works;
 * "Ask about first impressions" does not, because by the time it is read, the
 * "me" is the person who shared it.
 *
 * Nothing here asks for identifying information, and nothing invites an answer
 * that would out the sender — that would quietly undermine the one guarantee the
 * whole product rests on.
 */
export const WHISPER_PROMPTS: WhisperPrompt[] = [
  // --- funny ---
  { id: "f1", text: "What's the weirdest thing you think I'd actually do for money?", category: "funny" },
  { id: "f2", text: "What's my most unhinged habit?", category: "funny" },
  { id: "f3", text: "If I were an app notification, what would I say?", category: "funny" },
  { id: "f4", text: "What's something I do that's funnier than I realise?", category: "funny" },
  { id: "f5", text: "Describe me using only one emoji and no explanation.", category: "funny" },
  { id: "f6", text: "What would the title of my autobiography be?", category: "funny" },

  // --- deep ---
  { id: "d1", text: "What's something you've always wanted to tell me?", category: "deep" },
  { id: "d2", text: "What do you think I hide from people?", category: "deep" },
  { id: "d3", text: "What's something you secretly admire about me?", category: "deep" },
  { id: "d4", text: "What would you tell me if you knew I wouldn't get offended?", category: "deep" },
  { id: "d5", text: "When do I seem most like myself?", category: "deep" },
  { id: "d6", text: "What do you think I'm still carrying that I should put down?", category: "deep" },
  { id: "d7", text: "What's one thing about me that changed your mind about something?", category: "deep" },

  // --- romantic ---
  { id: "r1", text: "What would you tell me if you weren't afraid?", category: "romantic" },
  { id: "r2", text: "What's the first thing you noticed about me?", category: "romantic" },
  { id: "r3", text: "Have you ever almost said something to me and stopped?", category: "romantic" },
  { id: "r4", text: "What's something small I did that stayed with you?", category: "romantic" },
  { id: "r5", text: "Would you tell me if you liked me, or would you never say it?", category: "romantic" },

  // --- savage ---
  { id: "s1", text: "What's my biggest red flag?", category: "savage" },
  { id: "s2", text: "Be honest — what do I need to hear?", category: "savage" },
  { id: "s3", text: "What's the most annoying thing about me?", category: "savage" },
  { id: "s4", text: "Rate my personality out of 10 and justify it.", category: "savage" },
  { id: "s5", text: "What am I wrong about but refuse to admit?", category: "savage" },

  // --- friendship ---
  { id: "p1", text: "What's your favourite memory of us?", category: "friendship" },
  { id: "p2", text: "What's my biggest green flag?", category: "friendship" },
  { id: "p3", text: "Am I a good friend? Answer properly.", category: "friendship" },
  { id: "p4", text: "What do you come to me for?", category: "friendship" },
  { id: "p5", text: "What's something you've never told me but wanted to?", category: "friendship" },

  // --- school ---
  { id: "c1", text: "What did people actually say about me at school?", category: "school" },
  { id: "c2", text: "Who did you think I'd end up being?", category: "school" },
  { id: "c3", text: "What's the most embarrassing thing you remember me doing?", category: "school" },
  { id: "c4", text: "Was I the smart one, the funny one, or the quiet one?", category: "school" },

  // --- work ---
  { id: "w1", text: "What am I actually good at that nobody says out loud?", category: "work" },
  { id: "w2", text: "What should I stop doing at work?", category: "work" },
  { id: "w3", text: "Am I easy to work with? Be honest, it's anonymous.", category: "work" },
  { id: "w4", text: "What would you want me to know if I were your manager?", category: "work" },

  // --- random ---
  { id: "x1", text: "What's your first impression of me?", category: "random" },
  { id: "x2", text: "Tell me something you've never told anyone.", category: "random" },
  { id: "x3", text: "What's a question you'd never ask me to my face?", category: "random" },
  { id: "x4", text: "Say the thing. No name attached.", category: "random" },
  { id: "x5", text: "What do people get wrong about me?", category: "random" },
  { id: "x6", text: "If you could tell me one true thing, what would it be?", category: "random" },
];

/* --------------------------------------------------------------------------
 * Daily selection
 * ------------------------------------------------------------------------ */

/**
 * A stable integer for a calendar date, built from the *local* year/month/day.
 *
 * Deliberately not `Math.floor(date.getTime() / 86400000)`, which is a UTC day
 * and flips at the wrong hour for most of the world — someone in Lagos would get
 * tomorrow's prompt at 1am, and someone in Los Angeles would still be on
 * yesterday's at 4pm. Feeding the local parts through `Date.UTC` gives a plain
 * day counter that changes exactly at the user's own midnight.
 */
function localDayNumber(date: Date): number {
  return Math.floor(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000
  );
}

/** mulberry32 — small, fast, and good enough to shuffle a 40-item list. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher–Yates, driven by a seeded PRNG so the result is reproducible. */
function seededShuffle<T>(items: readonly T[], seed: number): T[] {
  const out = [...items];
  const random = mulberry32(seed);
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Today's prompt.
 *
 * Not `pool[day % pool.length]`, which is the obvious version and the wrong one:
 * it walks the list in the same order forever, so a prompt that lands on a
 * Monday lands on a Monday every cycle, and a user who checks daily can predict
 * the next one. Instead the pool is reshuffled once per full cycle using the
 * cycle number as the seed. Within a cycle nothing repeats; across cycles the
 * order is different but still perfectly reproducible from the date alone.
 */
export function promptForDate(date: Date, pool: WhisperPrompt[] = WHISPER_PROMPTS): WhisperPrompt {
  if (pool.length === 0) {
    return { id: "fallback", text: "Say the thing. No name attached.", category: "random" };
  }

  const day = localDayNumber(date);
  const cycle = Math.floor(day / pool.length);
  const index = ((day % pool.length) + pool.length) % pool.length;

  return seededShuffle(pool, cycle)[index];
}

/** Prompts in one category, or everything for `random`. */
export function promptsInCategory(category: PromptCategory): WhisperPrompt[] {
  if (category === "random") return WHISPER_PROMPTS;
  return WHISPER_PROMPTS.filter((prompt) => prompt.category === category);
}

/**
 * A different prompt from the given category.
 *
 * `exceptId` is why this takes the current prompt: a shuffle button that can
 * return what is already on screen reads as broken, and with five prompts in a
 * category that happens one time in five.
 */
export function nextPrompt(category: PromptCategory, exceptId?: string): WhisperPrompt {
  const pool = promptsInCategory(category);
  const candidates = pool.length > 1 ? pool.filter((prompt) => prompt.id !== exceptId) : pool;
  return candidates[Math.floor(Math.random() * candidates.length)] ?? WHISPER_PROMPTS[0];
}

/**
 * "Tuesday, 20 August" — the date, in the user's locale.
 *
 * Weekday included on purpose: a bare date is a label, a weekday is a nudge that
 * this is *today's* and there will be another tomorrow.
 */
export function formatPromptDate(date: Date): string {
  try {
    return date.toLocaleDateString(undefined, {
      weekday: "long",
      day: "numeric",
      month: "long",
    });
  } catch {
    return date.toDateString();
  }
}
