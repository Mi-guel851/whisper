// Anonymous handles.
//
// Shown wherever a user's real profile must stay hidden: Discover, Friends,
// Requests, the Inbox list, and the Chat header.
//
// THIS IS THE FALLBACK, NOT THE HANDLE.
//
// The real handle is `profiles.anon_name` — assigned once by the database under
// a unique index, so no two users can hold the same one (see
// `202608210001_unique_identities.sql`). `lib/anonNames.ts` fetches it. What
// this file does is fill the gap: `anonNameOf` is synchronous and the fetch is
// not, so this produces a plausible handle for the frame or two before the
// stored one lands.
//
// It used to be the handle, and that was the bug. Fifteen prefixes and a
// two-digit suffix is 1,500 names, so one user in fifteen was called "DarkWolf"
// and the same handle showed up four times in a list of sixty accounts. The
// namespace below is 30 x 28 x 9000 = 7,560,000 and matches the database's word
// lists exactly, so a fallback and a stored handle are indistinguishable — the
// swap never flickers into a different-looking name.
//
// It is still a hash, so it can still collide; only the stored handle is
// guaranteed unique. That is why it is the fallback and not the source.

/** Mirrors `whisper_anon_name_for` in the migration. Keep the two in step. */
const ADJECTIVES = [
  "Dark", "Night", "Neon", "Silent", "Void", "Moon", "Nova", "Pixel", "Echo",
  "Alpha", "Ghost", "Shadow", "Cipher", "Ember", "Frost", "Storm", "Solar",
  "Lunar", "Astral", "Crimson", "Cobalt", "Onyx", "Velvet", "Static", "Hollow",
  "Quiet", "Faded", "Muted", "Drift", "Zero",
] as const;

const NOUNS = [
  "Wolf", "Fox", "Ghost", "Echo", "Raven", "Owl", "Lynx", "Void", "Nova",
  "Shade", "Wisp", "Specter", "Phantom", "Ember", "Comet", "Cipher", "Drifter",
  "Signal", "Static", "Whisper", "Mirage", "Vector", "Pulse", "Reign",
  "Sparrow", "Falcon", "Serpent", "Halo",
] as const;

/**
 * FNV-1a. The previous `hash * 31 + charCode` barely moved its low bits across
 * UUIDs, which share most of their alphabet — so the prefix it picked was close
 * to constant across users, on top of there only being fifteen of them.
 */
export function hashUserId(userId: string) {
  let value = 0x811c9dc5;
  for (let index = 0; index < userId.length; index += 1) {
    value ^= userId.charCodeAt(index);
    value = Math.imul(value, 0x01000193);
  }
  return value >>> 0;
}

export function anonymousDisplayName(userId?: string | null) {
  if (!userId) return "Ghost.0000";

  // Three independent digests rather than three slices of one. Slicing ties the
  // adjective, the noun and the number together, so two ids that agree in the
  // low bits produce names that rhyme instead of names that differ.
  const a = hashUserId(userId);
  const b = hashUserId(`${userId}::noun`);
  const c = hashUserId(`${userId}::number`);

  return `${ADJECTIVES[a % ADJECTIVES.length]}${NOUNS[b % NOUNS.length]}.${
    1000 + (c % 9000)
  }`;
}
