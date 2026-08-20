/**
 * Whisper Games — named prompts with a face.
 *
 * A game here is not a mini-app with rules and state; it is a prompt that has
 * been given an identity so it is easier to send than to think of. That is the
 * whole mechanic, and it is deliberately not more than that: the thing users
 * struggle with is not playing, it is deciding what to ask. "Red Flag" is a
 * decision already made for them.
 *
 * Because a game is just a prompt plus presentation, this needs no table, no
 * state and no migration — the same reasoning as lib/dailyWhisper.ts. Each game
 * carries its own gradient so the grid reads as a set of distinct things rather
 * than eight identical cards, and every gradient is built from Whisper's own
 * accent hues (cyan #22d3ee, violet #8b5cf6, pink #ec4899, amber) rather than
 * new brand colours.
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
    prompt: "What's my biggest red flag? Be honest, it's anonymous.",
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

export function gameById(id: string): WhisperGame | undefined {
  return WHISPER_GAMES.find((game) => game.id === id);
}

/** CSS gradient string for a game tile. */
export function gameGradient(game: WhisperGame, angle = 135): string {
  return `linear-gradient(${angle}deg, ${game.gradient[0]}, ${game.gradient[1]})`;
}
