/**
 * Whisper Games and the Daily Whisper prompt.
 *
 * A game here is not a mini-app with rules and state; it is a prompt that has
 * been given an identity so it is easier to send than to think of. That is the
 * whole mechanic, and it is deliberately not more than that — the same reasoning
 * as the web app's `lib/whisperGames.ts` and `lib/dailyWhisper.ts`: no table, no
 * state, no migration. Each game carries its own two-stop gradient built from
 * Whisper's accent hues.
 */

export type WhisperGame = {
  id: string;
  title: string;
  emoji: string;
  /** One line under the title. Describes the payoff, not the mechanic. */
  tagline: string;
  /** What actually gets shared. Second person — the sender reads it. */
  prompt: string;
  /** Two-stop gradient for the card's tile. */
  gradient: [string, string];
};

export const WHISPER_GAMES: WhisperGame[] = [
  {
    id: "rate-me",
    title: "Rate Me",
    emoji: "⭐",
    tagline: "Out of 10. No mercy.",
    prompt: "Rate my personality from 1 to 10 — and say why.",
    gradient: ["#f59e0b", "#ec4899"],
  },
  {
    id: "first-impression",
    title: "First Impression",
    emoji: "👀",
    tagline: "What they thought before they knew you.",
    prompt: "What was your honest first impression of me?",
    gradient: ["#22d3ee", "#6366f1"],
  },
  {
    id: "red-flag",
    title: "Red Flag",
    emoji: "🚩",
    tagline: "The one nobody says to your face.",
    prompt: "What's my biggest red flag? Be honest, Don't lie.",
    gradient: ["#ef4444", "#ec4899"],
  },
  {
    id: "green-flag",
    title: "Green Flag",
    emoji: "🟢",
    tagline: "The good one. You've earned it.",
    prompt: "What's my biggest green flag?",
    gradient: ["#10b981", "#22d3ee"],
  },
  {
    id: "truth-or-dare",
    title: "Truth or Dare",
    emoji: "🎭",
    tagline: "Anonymous truth. No consequences.",
    prompt: "Give me an anonymous truth — something you'd never say out loud.",
    gradient: ["#8b5cf6", "#ec4899"],
  },
  {
    id: "would-you-rather",
    title: "Would You Rather",
    emoji: "🤔",
    tagline: "Force them to choose.",
    prompt: "Would you rather date your best friend or your crush? Answer anonymously.",
    gradient: ["#6366f1", "#22d3ee"],
  },
  {
    id: "confession",
    title: "Confession",
    emoji: "🤫",
    tagline: "The thing they've never told you.",
    prompt: "Tell me something you've never told me.",
    gradient: ["#0ea5e9", "#8b5cf6"],
  },
  {
    id: "unsent-message",
    title: "Unsent Message",
    emoji: "💌",
    tagline: "The message they typed and deleted.",
    prompt: "What's the message you typed out for me and never sent?",
    gradient: ["#ec4899", "#f59e0b"],
  },
];

/* ===========================================================================
   Daily Whisper — the prompt that changes every day.
   ===========================================================================
   The prompt is a pure function of the UTC date, so every user sees the same
   prompt on the same day without a single row being written or read. The pool
   is the web app's, one for one — a prompt that differs between the site and
   the phone would break the shared-moment quality that is the whole point. */

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
export const PROMPT_CATEGORIES: { key: PromptCategory; label: string; emoji: string }[] = [
  { key: "random", label: "Random", emoji: "🎲" },
  { key: "funny", label: "Funny", emoji: "😂" },
  { key: "deep", label: "Deep", emoji: "🌙" },
  { key: "romantic", label: "Romantic", emoji: "💫" },
  { key: "savage", label: "Savage", emoji: "🔥" },
  { key: "friendship", label: "Friends", emoji: "🤝" },
  { key: "school", label: "School", emoji: "🎓" },
  { key: "work", label: "Work", emoji: "💼" },
];
/** The pool, written in the second person and aimed at the sender — the web
 * app's `lib/dailyWhisper.ts` array, one for one, categories included. */
export const WHISPER_PROMPTS: WhisperPrompt[] = [
  { id: "f1", text: "What's the weirdest thing you think I'd actually do for money?", category: "funny" },
  { id: "f2", text: "What's my most unhinged habit?", category: "funny" },
  { id: "f3", text: "If I were an app notification, what would I say?", category: "funny" },
  { id: "f4", text: "What's something I do that's funnier than I realise?", category: "funny" },
  { id: "f5", text: "Describe me using only one emoji and no explanation.", category: "funny" },
  { id: "f6", text: "What would the title of my autobiography be?", category: "funny" },
  { id: "d1", text: "What's something you've always wanted to tell me?", category: "deep" },
  { id: "d2", text: "What do you think I hide from people?", category: "deep" },
  { id: "d3", text: "What's something you secretly admire about me?", category: "deep" },
  { id: "d4", text: "What would you tell me if you knew I wouldn't get offended?", category: "deep" },
  { id: "d5", text: "When do I seem most like myself?", category: "deep" },
  { id: "d6", text: "What do you think I'm still carrying that I should put down?", category: "deep" },
  { id: "d7", text: "What's one thing about me that changed your mind about something?", category: "deep" },
  { id: "r1", text: "What would you tell me if you weren't afraid?", category: "romantic" },
  { id: "r2", text: "What's the first thing you noticed about me?", category: "romantic" },
  { id: "r3", text: "Have you ever almost said something to me and stopped?", category: "romantic" },
  { id: "r4", text: "What's something small I did that stayed with you?", category: "romantic" },
  { id: "r5", text: "Would you tell me if you liked me, or would you never say it?", category: "romantic" },
  { id: "s1", text: "What's my biggest red flag?", category: "savage" },
  { id: "s2", text: "Be honest — what do I need to hear?", category: "savage" },
  { id: "s3", text: "What's the most annoying thing about me?", category: "savage" },
  { id: "s4", text: "Rate my personality out of 10 and justify it.", category: "savage" },
  { id: "s5", text: "What am I wrong about but refuse to admit?", category: "savage" },
  { id: "p1", text: "What's your favourite memory of us?", category: "friendship" },
  { id: "p2", text: "What's my biggest green flag?", category: "friendship" },
  { id: "p3", text: "Am I a good friend? Answer properly.", category: "friendship" },
  { id: "p4", text: "What do you come to me for?", category: "friendship" },
  { id: "p5", text: "What's something you've never told me but wanted to?", category: "friendship" },
  { id: "c1", text: "What did people actually say about me at school?", category: "school" },
  { id: "c2", text: "Who did you think I'd end up being?", category: "school" },
  { id: "c3", text: "What's the most embarrassing thing you remember me doing?", category: "school" },
  { id: "c4", text: "Was I the smart one, the funny one, or the quiet one?", category: "school" },
  { id: "w1", text: "What am I actually good at that nobody says out loud?", category: "work" },
  { id: "w2", text: "What should I stop doing at work?", category: "work" },
  { id: "w3", text: "Am I easy to work with? Be honest, it's anonymous.", category: "work" },
  { id: "w4", text: "What would you want me to know if I were your manager?", category: "work" },
  { id: "x1", text: "What's your first impression of me?", category: "random" },
  { id: "x2", text: "Tell me something you've never told anyone.", category: "random" },
  { id: "x3", text: "What's a question you'd never ask me to my face?", category: "random" },
  { id: "x4", text: "Say the thing. No name attached.", category: "random" },
  { id: "x5", text: "What do people get wrong about me?", category: "random" },
  { id: "x6", text: "If you could tell me one true thing, what would it be?", category: "random" },
];

/* ---- The date arithmetic and the shuffle, ported line for line from the web
   app's `lib/dailyWhisper.ts` so day N is the same prompt on both clients. ---- */

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

/** Today's prompt. */
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
 * A different prompt from the given category. `exceptId` is why this takes the
 * current prompt: a shuffle button that can return what is already on screen
 * reads as broken.
 */
export function nextPrompt(category: PromptCategory, exceptId?: string): WhisperPrompt {
  const pool = promptsInCategory(category);
  const candidates = pool.length > 1 ? pool.filter((prompt) => prompt.id !== exceptId) : pool;
  return candidates[Math.floor(Math.random() * candidates.length)] ?? WHISPER_PROMPTS[0];
}

/**
 * "Tuesday, 20 August" — the date, in the user's locale. Weekday included on
 * purpose: a bare date is a label, a weekday is a nudge that this is *today's*
 * and there will be another tomorrow.
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

/** The public feed's "question of the day" — the web app's own rotation. */
export const DAILY_QUESTIONS = [
  "What's something you've never told anyone?",
  "What would you do differently if nobody was watching?",
  "Who are you still not over?",
  "What's the kindest thing a stranger has done for you?",
  "What are you pretending not to know?",
  "What's the last thing that made you cry?",
  "What compliment do you never believe?",
  "What are you most afraid people will find out?",
  "What did you need to hear five years ago?",
  "What's a small thing that instantly ruins your day?",
  "Who do you miss but would never text?",
  "What are you proud of that nobody knows about?",
  "What's the lie you tell most often?",
  "What do you wish you could say to your younger self?",
  "What's keeping you up lately?",
  "What's something everyone else seems to enjoy but you don't?",
  "When did you last feel genuinely proud of yourself?",
  "What's a rule you break constantly?",
  "What do you want but feel guilty for wanting?",
  "What's the nicest thing you've ever done anonymously?",
  "Who changed your life in a single conversation?",
  "What's your most irrational fear?",
  "What are you still angry about?",
  "What's something you've forgiven but not forgotten?",
  "What would your closest friend be surprised to learn?",
  "What's the best advice you've ignored?",
  "What do you do when nobody's home?",
  "What's a moment you'd relive exactly as it happened?",
  "What are you putting off, and why?",
  "What do you hope happens this year?",
  "What's the hardest thing you've had to accept?",
] as const;

/**
 * The feed question for a given day. Same UTC-date arithmetic as the web's
 * `dailyQuestionFor` — one global room, one question.
 */
export function dailyQuestionFor(date: Date = new Date()): string {
  const dayIndex = Math.floor(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) / 86_400_000
  );
  const pool = DAILY_QUESTIONS;
  return pool[((dayIndex % pool.length) + pool.length) % pool.length];
}