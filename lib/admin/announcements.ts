/**
 * Validation for the announcement composer.
 *
 * Shared by POST and PATCH so the two cannot drift, and kept out of the route
 * file because Next type-checks route exports — a helper exported from a
 * `route.ts` is a build error, not a convenience.
 *
 * Every rule here is also a constraint on `public.announcements`
 * (202609080002 §A1). The two agreeing is the point: the constraint is the
 * guarantee, and this is what turns a violation into a sentence an admin can
 * act on instead of a 500.
 */

const KINDS = new Set(["info", "poll", "cta", "maintenance"]);
const AUDIENCES = new Set([
  "everyone",
  "new_users",
  "active_users",
  "inactive_users",
  "specific_users",
  "banned_users",
]);

/** Internal routes an announcement button may point at. */
const INTERNAL_ROUTES = new Set([
  "/dashboard",
  "/public-feed",
  "/inbox",
  "/premium",
  "/profile",
  "/creator",
  "/discover",
  "/friends",
  "/games",
  "/appearance",
  "/settings",
  "/contact-support",
  "/help-center",
  "/community-guidelines",
  "/complete-profile",
  "/notifications",
  "/official",
  "/active",
]);

/** Hosts the app already links to. A CTA anywhere else needs a code change. */
const ALLOWED_HOSTS = new Set([
  "whisper-anonymous.vercel.app",
  "twitter.com",
  "x.com",
  "instagram.com",
  "tiktok.com",
  "t.me",
  "discord.com",
  "whatsapp.com",
  "wa.me",
  "facebook.com",
  "youtube.com",
  "play.google.com",
  "apps.apple.com",
]);

/** A targeted announcement is a moderation tool, not a mailing list. */
export const MAX_SPECIFIC_AUDIENCE = 500;
const MAX_POLL_OPTIONS = 6;
const MAX_POLL_OPTION_CHARS = 60;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Whether a CTA target is allowed.
 *
 * `ctaHref` is the one field in an announcement that can hurt someone: it is
 * rendered as a button every targeted user is invited to press. An announcement
 * is otherwise a perfect vehicle for pointing a million people at an attacker's
 * domain, and this allowlist is what stops that.
 */
export function isAllowedCtaHref(href: string): boolean {
  if (!href) return false;

  if (href.startsWith("/")) {
    /* Rejected before the internal-route check: `//evil.com` starts with a
       slash, satisfies `startsWith("/")`, and resolves off-site. */
    if (href.startsWith("//")) return false;
    const path = href.split("?")[0].split("#")[0];
    return INTERNAL_ROUTES.has(path) || /^\/u\/[\w.-]+$/.test(path);
  }

  try {
    const url = new URL(href);
    return url.protocol === "https:" && ALLOWED_HOSTS.has(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

/**
 * Illustrations come from the same two places the rest of the app's images do:
 * a same-origin `/…` path in `public/`, or a Cloudinary delivery URL. Anything
 * else would let an announcement beacon a reader's IP to an arbitrary host the
 * moment the dialog opens.
 */
export function isAllowedImageUrl(url: string): boolean {
  if (url.startsWith("/") && !url.startsWith("//")) return true;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && parsed.hostname.endsWith(".cloudinary.com");
  } catch {
    return false;
  }
}

export type AnnouncementPayload = {
  kind: string;
  title: string;
  body: string;
  imageUrl: string | null;
  ctaLabel: string | null;
  ctaHref: string | null;
  audience: string;
  audienceIds: string[];
  startsAt: string | null;
  endsAt: string | null;
  active: boolean;
  pollOptions: string[];
};

export function validateAnnouncement(
  body: unknown
): { ok: true; value: AnnouncementPayload } | { ok: false; error: string } {
  const raw = (body ?? {}) as Record<string, unknown>;
  const str = (key: string) => (typeof raw[key] === "string" ? (raw[key] as string).trim() : "");

  const kind = str("kind") || "info";
  if (!KINDS.has(kind)) return { ok: false, error: "Unknown announcement type." };

  const title = str("title").slice(0, 80);
  if (!title) return { ok: false, error: "A title is required." };

  const message = str("body").slice(0, 600);
  if (!message) return { ok: false, error: "A message is required." };

  const audience = str("audience") || "everyone";
  if (!AUDIENCES.has(audience)) return { ok: false, error: "Unknown audience." };

  const ctaLabel = str("ctaLabel").slice(0, 40) || null;
  const ctaHref = str("ctaHref") || null;
  /* A label with nowhere to go is a dead button; a destination with no label
     renders nothing to press. Both halves or neither. */
  if ((ctaLabel && !ctaHref) || (!ctaLabel && ctaHref)) {
    return { ok: false, error: "A button needs both a label and a destination." };
  }
  if (ctaHref && !isAllowedCtaHref(ctaHref)) {
    return {
      ok: false,
      error:
        "That destination isn't allowed. Announcements can link to Whisper pages, or to https addresses on domains Whisper already links to.",
    };
  }

  const imageUrl = str("imageUrl") || null;
  if (imageUrl && !isAllowedImageUrl(imageUrl)) {
    return { ok: false, error: "That image address isn't allowed." };
  }

  const audienceIds = Array.isArray(raw.audienceIds)
    ? (raw.audienceIds as unknown[]).filter(
        (value): value is string => typeof value === "string" && UUID_PATTERN.test(value)
      )
    : [];
  if (audience === "specific_users" && audienceIds.length === 0) {
    return { ok: false, error: "Pick at least one account for a targeted announcement." };
  }
  if (audienceIds.length > MAX_SPECIFIC_AUDIENCE) {
    return {
      ok: false,
      error: `A targeted announcement reaches at most ${MAX_SPECIFIC_AUDIENCE} accounts.`,
    };
  }

  const pollOptions =
    kind === "poll"
      ? (Array.isArray(raw.pollOptions) ? (raw.pollOptions as unknown[]) : [])
          .map((option) => (typeof option === "string" ? option.trim() : ""))
          .filter(Boolean)
          .slice(0, MAX_POLL_OPTIONS)
          .map((option) => option.slice(0, MAX_POLL_OPTION_CHARS))
      : [];
  if (kind === "poll" && pollOptions.length < 2) {
    return { ok: false, error: "A poll needs at least two options." };
  }

  const startsAt = parseIso(raw.startsAt);
  const endsAt = parseIso(raw.endsAt);
  if (startsAt && endsAt && startsAt >= endsAt) {
    return { ok: false, error: "The end time has to be after the start time." };
  }
  if (endsAt && endsAt <= new Date()) {
    return { ok: false, error: "That end time is already in the past." };
  }

  return {
    ok: true,
    value: {
      kind,
      title,
      body: message,
      imageUrl,
      ctaLabel,
      ctaHref,
      audience,
      audienceIds: audience === "specific_users" ? audienceIds : [],
      startsAt: startsAt ? startsAt.toISOString() : null,
      endsAt: endsAt ? endsAt.toISOString() : null,
      active: raw.active === true || raw.active === "true",
      pollOptions,
    },
  };
}

/** `<input type="datetime-local">` sends a local-time string with no zone. */
function parseIso(value: unknown): Date | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
