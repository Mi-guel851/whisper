/**
 * The system-generated avatar for a registered user.
 *
 * Seeded by user id, so it is unique per user by construction — two accounts
 * cannot land on the same seed, and it needs no storage, no assignment step and
 * no uniqueness constraint. It is also stable: the same user is the same face on
 * every device and every render.
 *
 * What *did* repeat is the look. Every avatar came from one DiceBear style, so a
 * screen full of them read as variations of a single character rather than as
 * different people. Rotating the style by the same hash multiplies the visual
 * range by six while keeping each user's own face fixed forever.
 *
 * Note this changes the face of most existing accounts once, the first time this
 * ships. That is the point — the old faces were the ones that looked alike — and
 * these are generated placeholders, not anything a user chose or uploaded. An
 * uploaded picture lives in `profiles.avatar_url` and is never touched by this.
 */

/* Six styles that share a flat, friendly illustration vibe, so a mixed list
   still looks like one product. Deliberately no `bottts`/`shapes`/`identicon`:
   those are objects and patterns, and half the users would stop having a face. */
const AVATAR_STYLES = [
  "adventurer",
  "lorelei",
  "notionists",
  "open-peeps",
  "personas",
  "micah",
] as const;

/**
 * FNV-1a, matching `components/home/Avatar.tsx`. A character sum would cluster
 * badly here: user ids are UUIDs that share most of their alphabet, so the low
 * bits of a sum barely move and most users would land on the same style.
 */
function hash(seed: string) {
  let value = 0x811c9dc5;
  for (let index = 0; index < seed.length; index += 1) {
    value ^= seed.charCodeAt(index);
    value = Math.imul(value, 0x01000193);
  }
  return value >>> 0;
}

const avatarCache = new Map<string, string>();

export function generatedAvatarUrl(userId: string) {
  const cached = avatarCache.get(userId);
  if (cached) return cached;

  const style = AVATAR_STYLES[hash(userId) % AVATAR_STYLES.length];
  const url = `https://api.dicebear.com/9.x/${style}/svg?seed=${encodeURIComponent(userId)}`;

  avatarCache.set(userId, url);
  return url;
}
