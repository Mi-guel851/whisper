"use client";

import { supabase } from "@/lib/supabase/client";

/**
 * The client half of the admin panel's data layer.
 *
 * EVERY request carries two things: the caller's Supabase access token, and the
 * admin PIN. Both are checked server-side in lib/admin/auth.ts before any data is
 * touched, and neither is sufficient alone.
 *
 * WHAT THE PIN IS AND IS NOT
 *
 * It is not a session. Holding it in React state proves nothing to the server —
 * a route that trusted "the panel is unlocked" would be a route any signed-in user
 * could call. It is a shared secret re-sent on every request precisely so that
 * unlocking the UI cannot substitute for knowing it. That is the same reasoning
 * 202608190004 applied to coin granting, and it is why `grant-coins` was already
 * posting the PIN with each request rather than once.
 *
 * It lives in sessionStorage, not localStorage: an admin walking away from a
 * shared machine should not hand the next person a key, and a tab close is a
 * reasonable definition of "done for now". It is never written to a cookie, never
 * put in a URL, and never sent anywhere except `/api/admin/*`.
 */

const PIN_STORAGE_KEY = "whisper-admin-pin";

export function getStoredPin(): string | null {
  try {
    return window.sessionStorage.getItem(PIN_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setStoredPin(pin: string) {
  try {
    window.sessionStorage.setItem(PIN_STORAGE_KEY, pin);
  } catch {
    /* Private mode. The panel still works; it just asks again on reload. */
  }
}

export function clearStoredPin() {
  try {
    window.sessionStorage.removeItem(PIN_STORAGE_KEY);
  } catch {
    /* Nothing to do. */
  }
}

export class AdminRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** A missing env var or migration, as opposed to something the admin did. */
    readonly misconfigured = false
  ) {
    super(message);
    this.name = "AdminRequestError";
  }
}

type AdminFetchOptions = {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  pin?: string;
  signal?: AbortSignal;
};

/**
 * One round trip to an admin endpoint.
 *
 * Throws `AdminRequestError` on any non-2xx, so callers get one shape of failure
 * to handle instead of inspecting responses. A 401 clears the stored PIN, because
 * the only 401 these routes return for a correct token is a wrong or stale PIN and
 * retrying with the same one cannot help.
 */
export async function adminFetch<T>(path: string, options: AdminFetchOptions = {}): Promise<T> {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    throw new AdminRequestError("You need to sign in to use the admin panel.", 401);
  }

  const pin = options.pin ?? getStoredPin() ?? "";

  const response = await fetch(path, {
    method: options.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
      "x-admin-pin": pin,
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: options.signal,
    /* Never cached. These are moderation views; a stale one is a wrong one. */
    cache: "no-store",
  });

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    /* A non-JSON body from a proxy or an error page. Handled below. */
  }

  if (!response.ok) {
    const body = (payload ?? {}) as { error?: string; misconfigured?: boolean };
    if (response.status === 401) clearStoredPin();
    throw new AdminRequestError(
      body.error ?? `Request failed (${response.status}).`,
      response.status,
      body.misconfigured === true
    );
  }

  return payload as T;
}

/** Builds `/api/admin/users?q=…&status=…` without hand-escaping anything. */
export function withQuery(path: string, params: Record<string, string | number | null | undefined>): string {
  const url = new URL(path, "http://local");
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined || value === "") continue;
    url.searchParams.set(key, String(value));
  }
  return `${url.pathname}${url.search}`;
}

/* -------------------------------------------------------------------------- */
/* Response shapes                                                            */
/* -------------------------------------------------------------------------- */

export type AdminStats = {
  totals: {
    total_users: number;
    total_whispers: number;
    total_direct_messages: number;
    total_feed_posts: number;
    total_whisper_images: number;
    total_chat_images: number;
    total_feed_images: number;
    coins_held: number;
    coins_spent: number;
    coins_purchased: number;
    coins_granted: number;
    banned_users: number;
    bans_all_time: number;
    pending_reports: number;
    reviewing_reports: number;
    active_announcements: number;
    announcements_all_time: number;
  };
  today: {
    users_today: number;
    users_yesterday: number;
    users_this_week: number;
    users_this_month: number;
    whispers_today: number;
    whispers_yesterday: number;
    direct_messages_today: number;
    chat_images_today: number;
    whisper_images_today: number;
    feed_posts_today: number;
    feed_images_today: number;
  };
  registrations: Array<{ date: string; count: number }>;
  computed_at: string;
  generated_at: string;
};

export type AdminUserRow = {
  id: string;
  username: string;
  display_name: string | null;
  email: string | null;
  email_masked: string | null;
  phone_number: string | null;
  phone_masked: string | null;
  dial_code: string | null;
  country: string | null;
  created_at: string;
  coin_balance: number;
  status: "active" | "banned";
  last_sign_in: string | null;
  profile_done: boolean | null;
};

export type AdminUserList = {
  users: AdminUserRow[];
  total: number;
  nextCursor: { afterTs: string; afterId: string } | null;
};

export type AdminBanRow = {
  id: string;
  reason: string;
  duration: "permanent" | "temporary";
  expires_at: string | null;
  active: boolean;
  created_at: string;
  sessions_revoked: boolean;
  banned_by: string | null;
};

export type AdminCoinTransaction = {
  transaction_type: string;
  amount: number;
  description: string;
  created_at: string;
  granted_by: string | null;
};

export type AdminUserDetail = {
  profile: {
    id: string;
    username: string;
    display_name: string | null;
    email: string | null;
    email_confirmed_at: string | null;
    phone_number: string | null;
    dial_code: string | null;
    country: string | null;
    created_at: string;
    profile_completed: boolean;
    is_admin: boolean;
    last_sign_in_at: string | null;
    banned_until: string | null;
    coin_balance: number;
  };
  activity: {
    whispers_received: number;
    direct_messages_sent: number;
    images_sent: number;
    feed_posts: number;
    feed_replies: number;
    reactions_given: number;
  };
  coins: {
    granted: number;
    purchased: number;
    spent: number;
    transactions: AdminCoinTransaction[];
  };
  moderation: {
    bans: AdminBanRow[];
    reports_against: number;
    reports_filed: number;
  };
};

export type AdminReport = {
  id: string;
  post_id: string | null;
  reason: string;
  details: string | null;
  status: "pending" | "reviewing" | "resolved" | "dismissed";
  created_at: string;
  reviewed_at: string | null;
  resolution_note: string | null;
  post_excerpt: string | null;
  author_id: string | null;
  author_username: string | null;
  reporter_username: string | null;
  author_banned: boolean;
};

export type AdminReportsPage = {
  reports: AdminReport[];
  counts: { pending: number; reviewing: number; resolved: number; dismissed: number };
};

export type AdminAnnouncement = {
  id: string;
  kind: "info" | "poll" | "cta" | "maintenance";
  title: string;
  body: string;
  image_url: string | null;
  cta_label: string | null;
  cta_href: string | null;
  audience: string;
  audience_ids: string[];
  starts_at: string | null;
  ends_at: string | null;
  active: boolean;
  poll_options: string[];
  created_at: string;
  updated_at: string;
  published_at: string | null;
  created_by: string | null;
  total_votes: number;
  vote_counts: number[];
  state: "draft" | "scheduled" | "active" | "expired";
};

export type AdminAuditEntry = {
  id: number;
  action: string;
  created_at: string;
  admin_user_id: string | null;
  admin_username: string | null;
  target_user_id: string | null;
  target_username: string | null;
  metadata: Record<string, unknown>;
};

export type AdminLedgerRow = {
  id: string;
  user_id: string;
  username: string | null;
  transaction_type: string;
  amount: number;
  description: string;
  granted_by: string | null;
  granted_by_name: string | null;
  created_at: string;
};
