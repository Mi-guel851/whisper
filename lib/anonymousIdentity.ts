// Shared anonymous-identity generator.
//
// This is used everywhere a user's real profile must stay hidden: Discover,
// Friends, Requests, the Inbox chat list, and the Chat header. The name is a
// pure function of the user's id, so it is always the same for a given user
// and never changes on reload — there is nothing stored in the database for
// it, and nothing here ever reads a username or other profile field.

export const ANONYMOUS_PREFIXES = [
  "Shadow",
  "DarkWolf",
  "Ghost",
  "SilentFox",
  "NightEcho",
  "AlphaVoid",
  "Yoganony",
  "NovaGhost",
  "Cipher",
  "PixelVoid",
  "MoonShade",
  "EchoWolf",
  "VoidFox",
  "NeonGhost",
  "SilentNova",
];

export function hashUserId(userId: string) {
  let hash = 0;
  for (let index = 0; index < userId.length; index += 1) {
    hash = (hash * 31 + userId.charCodeAt(index)) >>> 0;
  }
  return hash;
}

export function anonymousDisplayName(userId?: string | null) {
  if (!userId) return "Ghost.00";
  const hash = hashUserId(userId);
  const prefix = ANONYMOUS_PREFIXES[hash % ANONYMOUS_PREFIXES.length];
  const suffix = String(hash % 100).padStart(2, "0");
  return `${prefix}.${suffix}`;
}