import { Platform } from "react-native";

import { apiBase } from "./feed";
import { supabase } from "./supabase";

/**
 * The admin API client — the native port of the web app's
 * `lib/admin/client.ts`.
 *
 * Every call carries two credentials:
 *
 *   - `Authorization: Bearer <session>` — who the caller is. The route
 *     re-verifies the email against the server-side allowlist on every
 *     request; nothing the client does can widen that.
 *   - `x-admin-pin: <pin>` — the second factor. The web keeps the PIN in
 *     sessionStorage ("an admin walking away from a desk should not leave the
 *     panel open"); the native equivalent is module memory — it dies with the
 *     JS context, so it is never written to disk.
 */

/** The web app's admin allowlist (`lib/admin/emails.ts`). */
export const DEFAULT_ADMIN_EMAILS = ["mfonisobassey851@gmail.com", "basseyaniekeme43@gmail.com"] as const;

function adminEmails(): Set<string> {
  const raw = (process.env.EXPO_PUBLIC_ADMIN_EMAILS ?? "").split(",");
  const parsed = raw.map((email: string) => email.trim().toLowerCase()).filter(Boolean);
  return new Set(parsed.length > 0 ? parsed : DEFAULT_ADMIN_EMAILS);
}

/** Whether this account may open the admin console (the *shown* gate — every
    route the console calls re-verifies server-side). */
export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return adminEmails().has(email.trim().toLowerCase());
}

/* The PIN lives in module memory — the native twin of sessionStorage. */
let storedPin: string | null = null;

export function setStoredPin(pin: string) {
  storedPin = pin;
}

export function getStoredPin(): string | null {
  return storedPin;
}

export function clearStoredPin() {
  storedPin = null;
}

export class AdminRequestError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function adminFetch<T>(path: string, options: { pin?: string; method?: string; body?: unknown } = {}): Promise<T> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new AdminRequestError("Sign in first.", 401);

  const pin = options.pin ?? getStoredPin() ?? "";
  const res = await fetch(`${apiBase()}${path}`, {
    method: options.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
      "x-admin-pin": pin,
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new AdminRequestError(typeof json.error === "string" ? json.error : `Request failed (${res.status}).`, res.status);
  }
  return json as T;
}

/* ------------------------------------------------------------------ */
/* Announcements — the shapes `lib/admin/announcements.ts` validates.  */
/* ------------------------------------------------------------------ */

export const ANNOUNCEMENT_KINDS = ["info", "poll", "cta", "maintenance"] as const;
export type AnnouncementKind = (typeof ANNOUNCEMENT_KINDS)[number];

export const ANNOUNCEMENT_AUDIENCES = [
  "everyone",
  "new_users",
  "active_users",
  "inactive_users",
  "banned_users",
] as const;
export type AnnouncementAudience = (typeof ANNOUNCEMENT_AUDIENCES)[number];

export const MAX_POLL_OPTIONS = 6;

export type AnnouncementPayload = {
  kind: AnnouncementKind;
  title: string;
  body: string;
  imageUrl: string | null;
  ctaLabel: string | null;
  ctaHref: string | null;
  audience: AnnouncementAudience;
  audienceIds: string[];
  startsAt: string | null;
  endsAt: string | null;
  active: boolean;
  pollOptions: string[];
};

export type AdminAnnouncement = Omit<AnnouncementPayload, "pollOptions"> & {
  id: string;
  /** The API returns the RPC row: snake_case column names. */
  poll_options: string[] | null;
  total_votes: number;
  vote_counts: number[];
  state: "draft" | "scheduled" | "active" | "expired";
  created_at: string;
  published_at: string | null;
};

export function listAnnouncements(): Promise<{ announcements: AdminAnnouncement[] }> {
  return adminFetch("/api/admin/announcements");
}

/** Publish one announcement. The server re-validates every field — this
    client-side mirror only spares the admin a round trip. */
export function createAnnouncement(payload: AnnouncementPayload): Promise<{ id: string }> {
  return adminFetch("/api/admin/announcements", { method: "POST", body: payload });
}

/** Verify a PIN against the server (`/api/admin/session`). Throws with the
    route's own message when the PIN is wrong. */
export async function verifyPin(pin: string): Promise<{ email: string | null }> {
  const result = await adminFetch<{ email: string | null; adminId?: string }>("/api/admin/session", { pin });
  setStoredPin(pin);
  return result;
}
