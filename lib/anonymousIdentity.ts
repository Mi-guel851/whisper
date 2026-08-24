// Anonymous handles.
//
// Shown wherever a user's real profile must stay hidden: Discover, Friends,
// Requests, the Inbox list, and the Chat header.
//
// THIS AGREES WITH THE DATABASE, EXACTLY.
//
// The stored handle is `profiles.anon_name`, assigned once under a unique index
// (see `202608210001_unique_identities.sql`), and `lib/anonNames.ts` fetches it.
// This file computes the same string locally, so it can be rendered synchronously
// in the first frame instead of waiting for that fetch.
//
// "The same string" is load-bearing and it used not to be true. The original pair
// only matched in *shape*: this file hashed the user id to `DarkWolf.4821` while
// the trigger took a sequence value and produced `NeonRaven.1234`. Two namespaces
// for one person. Usually that was a flicker nobody caught — but a profile row
// created after the user is already on screen (a first Google sign-in, where the
// row is written at /setup) meant the name they had been shown was replaced by an
// unrelated one, and it looked like the handle changed on every login.
//
// `202608240001_stable_anon_names.sql` moved the database onto this derivation:
// `whisper_anon_name_from_id` reimplements the FNV-1a triple-hash below in plpgsql
// and the insert trigger prefers it. So a handle is now a function of the user id
// on both sides — it survives the profile row, and the swap from local to stored
// is invisible because there is nothing to swap.
//
// It is still a hash into 30 x 28 x 9000 = 7,560,000 names, so it can still
// collide; the unique index remains the authority and a losing row falls back to
// the sequence. That case is rare and, once stored, stable.
//
// The word lists and the hash are mirrored in that migration. All three — this
// file, `whisper_anon_name_from_id`, and `whisper_anon_name_for` — must stay in
// step.

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
