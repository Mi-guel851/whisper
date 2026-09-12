/**
 * Anonymous identity: display names and avatars.
 *
 * THIS IS A PORT OF THE WEB APP'S WEB CLIENT, AND IT HAS TO STAY EXACTLY THE
 * SAME STRING. `lib/anonymousIdentity.ts` in the web app computes a handle from
 * the user id and the database stores the identical value
 * (`whisper_anon_name_from_id` reimplements the same FNV-1a triple hash in
 * plpgsql). Three implementations, one output — so a user's handle is the same
 * here, on the website, and in the database.
 *
 * The stored value always wins when it is available (`profiles.anon_name`);
 * the local derivation is only what is on screen in the first frame, and it is
 * also what handles a profile row that has not been created yet.
 */

import { useEffect, useState } from "react";

import { supabase } from "./supabase";

/** Mirrors `whisper_anon_name_for`. Keep in step with the migration. */
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

/** FNV-1a. Matches `hashUserId` in the web app and `whisper_fnv1a` in SQL. */
export function hashUserId(userId: string): number {
  let value = 0x811c9dc5;
  for (let index = 0; index < userId.length; index += 1) {
    value ^= userId.charCodeAt(index);
    value = Math.imul(value, 0x01000193);
  }
  return value >>> 0;
}

/**
 * The synchronous fallback name. Three independent digests rather than three
 * slices of one, so two ids that agree in their low bits produce names that
 * differ rather than names that rhyme.
 */
export function anonymousDisplayName(userId?: string | null): string {
  if (!userId) return "Ghost.0000";

  const a = hashUserId(userId);
  const b = hashUserId(`${userId}::noun`);
  const c = hashUserId(`${userId}::number`);

  return `${ADJECTIVES[a % ADJECTIVES.length]}${NOUNS[b % NOUNS.length]}.${
    1000 + (c % 9000)
  }`;
}

/* ---------------------------------------------------------------------------
 * Generated avatars
 * ------------------------------------------------------------------------ */

/**
 * Six DiceBear styles, rotated by the same FNV-1a hash as the name. One style
 * for every user read as variations of a single character; six keeps each face
 * fixed forever while making a column of them scannable.
 */
const AVATAR_STYLES = [
  "adventurer",
  "lorelei",
  "notionists",
  "open-peeps",
  "personas",
  "micah",
] as const;

const avatarCache = new Map<string, string>();

/** The system-generated face for a user id. Stable across devices and renders. */
export function generatedAvatarUrl(userId: string): string {
  const cached = avatarCache.get(userId);
  if (cached) return cached;

  const style = AVATAR_STYLES[hashUserId(userId) % AVATAR_STYLES.length];
  const url = `https://api.dicebear.com/9.x/${style}/png?size=160&seed=${encodeURIComponent(userId)}`;

  avatarCache.set(userId, url);
  return url;
}

/* ---------------------------------------------------------------------------
 * Stored names — one query per screen, never one per row
 * ------------------------------------------------------------------------ */

const storedNames = new Map<string, string>();
/** Ids already asked about and answered with nothing. Stops re-asking per mount. */
const resolvedEmpty = new Set<string>();
const listeners = new Set<() => void>();

let version = 0;
let inFlight: Promise<void> | null = null;

/** Supabase sends `in` filters in the query string; chunk well below any limit. */
const CHUNK = 80;

function notify() {
  version += 1;
  for (const listener of listeners) listener();
}

export function subscribeAnonNames(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function anonNamesVersion() {
  return version;
}

/**
 * The best name we have right now, synchronously.
 *
 * Called during render, so it can never await. Returns the stored name when it
 * has arrived and the deterministic label until then — a blank name is never a
 * valid state.
 */
export function anonNameFor(userId?: string | null): string {
  if (!userId) return "Ghost.0000";
  return storedNames.get(userId) ?? anonymousDisplayName(userId);
}

/**
 * Fetches any of these names we do not have yet.
 *
 * Coalesced into one request per chunk and safe to call from every card: a
 * screen with forty posts asks for forty ids and makes one round trip.
 */
export async function ensureAnonNames(userIds: (string | null | undefined)[]): Promise<void> {
  const wanted = [
    ...new Set(
      userIds.filter(
        (id): id is string => Boolean(id) && !storedNames.has(id as string) && !resolvedEmpty.has(id as string)
      )
    ),
  ];

  if (wanted.length === 0) {
    if (inFlight) await inFlight;
    return;
  }

  inFlight = (async () => {
    let changed = false;

    for (let index = 0; index < wanted.length; index += CHUNK) {
      const ids = wanted.slice(index, index + CHUNK);
      const { data, error } = await supabase.from("profiles").select("id, anon_name").in("id", ids);

      if (error) {
        /* Pre-migration this is "column profiles.anon_name does not exist".
           Marking the ids resolved means we ask once and stop, instead of
           retrying on every screen that renders a name. */
        for (const id of ids) resolvedEmpty.add(id);
        continue;
      }

      for (const row of data ?? []) {
        const stored = (row as { id: string; anon_name: string | null }).anon_name;
        if (stored) {
          storedNames.set(row.id, stored);
          changed = true;
        } else {
          resolvedEmpty.add(row.id);
        }
      }

      for (const id of ids) {
        if (!storedNames.has(id)) resolvedEmpty.add(id);
      }
    }

    if (changed) notify();
  })().finally(() => {
    inFlight = null;
  });

  await inFlight;
}

/** Drops a cached name so the next read re-derives it. Used after a profile edit. */
export function forgetAnonName(userId: string) {
  storedNames.delete(userId);
  resolvedEmpty.delete(userId);
}

/* ---------------------------------------------------------------------------
 * React bindings
 * ------------------------------------------------------------------------ */

/**
 * The name to render for a user id, and the fetch that upgrades it.
 *
 * Subscribes to the module-level store rather than holding the name in local
 * state, so a name that lands for a card in one list is already there when the
 * same author appears in another — and so forty cards do not each subscribe to
 * their own query.
 */
export function useAnonName(userId?: string | null): string {
  const [name, setName] = useState(() => anonNameFor(userId));

  useEffect(() => {
    if (!userId) return;
    setName(anonNameFor(userId));

    const unsubscribe = subscribeAnonNames(() => setName(anonNameFor(userId)));
    void ensureAnonNames([userId]);

    return unsubscribe;
  }, [userId]);

  return name;
}

/** Resolves several authors at once — the feed card and its parent, for example. */
export function useAnonNames(userIds: (string | null | undefined)[]): string[] {
  const [names, setNames] = useState(() => userIds.map((id) => anonNameFor(id)));
  const key = userIds.join("|");

  useEffect(() => {
    const current = key ? key.split("|") : [];
    setNames(current.map((id) => anonNameFor(id)));

    const unsubscribe = subscribeAnonNames(() => setNames(current.map((id) => anonNameFor(id))));
    void ensureAnonNames(current);

    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return names;
}
