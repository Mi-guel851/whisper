import { supabase } from "./supabase";
import { safeErrorMessage } from "./errors";

/**
 * Friends — the data layer of the web app's `/friends` page, query for query.
 *
 *   `friends`          one row per direction (`user_id` → `friend_id`); the
 *                      list joins the friend's profile through the
 *                      `friends_friend_id_fkey` foreign key, the way the web
 *                      page's select spells it.
 *   `friend_requests`  `sender_id`, `receiver_id`, `status: 'pending'`, and an
 *                      `updated_at` the accept flow writes explicitly.
 *                      Accepting inserts BOTH friendship rows with
 *                      `source: "request"` — the send gate (202609090002)
 *                      matches a friendship in either direction, so a
 *                      rejected reverse row degrades to one-directional
 *                      rather than breaking the conversation.
 *   `blocked_users`    both directions, excluded from Discover.
 *   `conversations`    found or created with `user_a < user_b` ordering and
 *                      the 23505 race fallback the web's startChat runs.
 *
 * Push notifications for requests and acceptances are fired by the database's
 * `friend_request_event_trigger` — the client never writes a notification row
 * here either.
 */

export type FriendProfile = {
  id: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
  bio: string | null;
  country_code: string | null;
};

export type FriendRow = {
  id: string;
  user_id: string;
  friend_id: string;
  created_at: string;
  friend: FriendProfile | null;
};

export type FriendRequestRow = {
  id: string;
  sender_id: string;
  receiver_id: string;
  status: string;
  created_at: string;
  updated_at: string | null;
  sender: FriendProfile | null;
  receiver: FriendProfile | null;
};

export type RelatedUserIds = {
  friendIds: Set<string>;
  pendingIds: Set<string>;
  blockedUserIds: Set<string>;
};

const FRIEND_SELECT = "id,user_id,friend_id,created_at,friend:profiles!friends_friend_id_fkey(id,username,display_name,avatar_url,bio,country_code)";
const REQUEST_SELECT =
  "id,sender_id,receiver_id,status,created_at,updated_at," +
  "sender:profiles!friend_requests_sender_id_fkey(id,username,display_name,avatar_url,bio,country_code)," +
  "receiver:profiles!friend_requests_receiver_id_fkey(id,username,display_name,avatar_url,bio,country_code)";

/* The web page's own single-profile unwrapper: a joined `to_one` embed arrives
   as an object, but PostgREST returns an array shape under some settings, and
   a crash over one row's shape must not take the list down. */
function singleProfile(value: unknown): FriendProfile | null {
  if (!value) return null;
  if (Array.isArray(value)) return (value[0] as FriendProfile) ?? null;
  return value as FriendProfile;
}

export function normalizeFriendRows(rows: unknown[]): FriendRow[] {
  return (rows as FriendRow[]).map((row) => ({ ...row, friend: singleProfile(row.friend) }));
}

export function normalizeRequestRows(rows: unknown[]): FriendRequestRow[] {
  return (rows as FriendRequestRow[]).map((row) => ({
    ...row,
    sender: singleProfile(row.sender),
    receiver: singleProfile(row.receiver),
  }));
}

export async function fetchFriendRows(userId: string): Promise<FriendRow[]> {
  const { data, error } = await supabase
    .from("friends")
    .select(FRIEND_SELECT)
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return normalizeFriendRows(data || []);
}

export async function fetchRequestRows(
  userId: string
): Promise<{ incoming: FriendRequestRow[]; outgoing: FriendRequestRow[] }> {
  const [incomingRes, outgoingRes] = await Promise.all([
    supabase
      .from("friend_requests")
      .select(REQUEST_SELECT)
      .eq("receiver_id", userId)
      .eq("status", "pending")
      .order("created_at", { ascending: false }),
    supabase
      .from("friend_requests")
      .select(REQUEST_SELECT)
      .eq("sender_id", userId)
      .eq("status", "pending")
      .order("created_at", { ascending: false }),
  ]);

  if (incomingRes.error) throw incomingRes.error;
  if (outgoingRes.error) throw outgoingRes.error;

  return {
    incoming: normalizeRequestRows(incomingRes.data || []),
    outgoing: normalizeRequestRows(outgoingRes.data || []),
  };
}

/** Everyone this account already has a relationship with — the Discover tab's
    exclusion set, computed exactly as the web page computes it. */
export async function fetchRelatedUserIds(userId: string): Promise<RelatedUserIds> {
  const [friendsRes, requestsRes, blockedRes] = await Promise.all([
    supabase.from("friends").select("friend_id").eq("user_id", userId),
    supabase
      .from("friend_requests")
      .select("sender_id,receiver_id,status")
      .or(`sender_id.eq.${userId},receiver_id.eq.${userId}`),
    supabase
      .from("blocked_users")
      .select("user_id,blocked_user_id")
      .or(`user_id.eq.${userId},blocked_user_id.eq.${userId}`),
  ]);

  const friendIds = new Set((friendsRes.data || []).map((f) => (f as { friend_id: string }).friend_id));
  const pendingIds = new Set<string>();
  for (const r of (requestsRes.data || []) as { sender_id: string; receiver_id: string; status: string }[]) {
    if (r.status !== "pending") continue;
    pendingIds.add(r.sender_id === userId ? r.receiver_id : r.sender_id);
  }
  const blockedUserIds = new Set(
    (blockedRes.data || []).map((row) =>
      (row as { user_id: string; blocked_user_id: string }).user_id === userId
        ? (row as { blocked_user_id: string }).blocked_user_id
        : (row as { user_id: string }).user_id
    )
  );

  return { friendIds, pendingIds, blockedUserIds };
}

/**
 * One Discover page: an id-ordered scan over `profiles` with the related ids
 * removed client-side. Same query, same window arithmetic (`(page + 1) * 4 ×
 * PAGE_SIZE`) as the web page — the scan is coarse by design, because profiles
 * have no "discoverable" flag to filter on server-side.
 */
export async function fetchDiscoverPage(
  userId: string,
  page: number,
  pageSize: number,
  related: RelatedUserIds
): Promise<{ people: FriendProfile[]; hasMore: boolean }> {
  const excluded = new Set([userId, ...related.friendIds, ...related.pendingIds, ...related.blockedUserIds]);

  const { data, error } = await supabase
    .from("profiles")
    .select("id,username,display_name,avatar_url,bio,country_code")
    .order("id", { ascending: true })
    .range(0, Math.max((page + 1) * pageSize * 4, pageSize + 1));

  if (error) throw error;

  const visible = ((data || []) as FriendProfile[]).filter((p) => !excluded.has(p.id));
  return {
    people: visible.slice(0, (page + 1) * pageSize),
    hasMore: visible.length > (page + 1) * pageSize,
  };
}

/**
 * Sends a friend request. The web page checks for a pending request between
 * the pair first (a told "already exists" beats a 23505), then inserts.
 */
export async function sendFriendRequest(
  myId: string,
  profileId: string
): Promise<{ ok: boolean; error?: string; duplicate?: boolean }> {
  const { data: existing, error: existingError } = await supabase
    .from("friend_requests")
    .select("id,sender_id,receiver_id,status")
    .or(
      `and(sender_id.eq.${myId},receiver_id.eq.${profileId}),and(sender_id.eq.${profileId},receiver_id.eq.${myId})`
    )
    .eq("status", "pending")
    .maybeSingle();

  if (existingError) return { ok: false, error: safeErrorMessage(existingError, "Could not check for an existing request.") };
  if (existing) return { ok: false, duplicate: true, error: "A friend request already exists between you two." };

  const { error } = await supabase
    .from("friend_requests")
    .insert({ sender_id: myId, receiver_id: profileId, status: "pending" });

  if (error) {
    if (error.code === "23505") return { ok: false, duplicate: true, error: "A friend request already exists between you two." };
    return { ok: false, error: safeErrorMessage(error, "Friend request failed.") };
  }
  return { ok: true };
}

/**
 * Accepts a request. The row is re-read with the receiver + pending guard, the
 * status flips with `updated_at` written, then both friendship rows are
 * inserted with `source: "request"` — the web page's exact sequence, including
 * the warning-and-continue on a rejected reverse row.
 */
export async function acceptRequest(
  myId: string,
  requestId: string
): Promise<{ ok: boolean; error?: string; gone?: boolean }> {
  const { data: requestRow, error: fetchError } = await supabase
    .from("friend_requests")
    .select("id,sender_id,receiver_id,status")
    .eq("id", requestId)
    .eq("receiver_id", myId)
    .eq("status", "pending")
    .maybeSingle();

  if (fetchError) return { ok: false, error: safeErrorMessage(fetchError, "Could not load this request.") };
  if (!requestRow) return { ok: false, gone: true, error: "This request is no longer available." };

  const request = requestRow as { id: string; sender_id: string; receiver_id: string };

  const { error: updateError } = await supabase
    .from("friend_requests")
    .update({ status: "accepted", updated_at: new Date().toISOString() })
    .eq("id", requestId)
    .eq("receiver_id", myId)
    .eq("status", "pending");

  if (updateError) return { ok: false, error: safeErrorMessage(updateError, "Could not accept request.") };

  const { error: friendError } = await supabase
    .from("friends")
    .insert({ user_id: myId, friend_id: request.sender_id, source: "request" });
  if (friendError && friendError.code !== "23505") {
    return { ok: false, error: safeErrorMessage(friendError, "Request accepted, but adding the friend failed.") };
  }

  const { error: reverseError } = await supabase
    .from("friends")
    .insert({ user_id: request.sender_id, friend_id: myId, source: "request" });
  if (reverseError && reverseError.code !== "23505") {
    console.warn("Reverse friendship row not written (policy likely owner-only):", reverseError.message);
  }

  return { ok: true };
}

export async function declineRequest(myId: string, requestId: string): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase
    .from("friend_requests")
    .delete()
    .eq("id", requestId)
    .eq("receiver_id", myId)
    .eq("status", "pending");
  return error ? { ok: false, error: safeErrorMessage(error, "Could not decline request.") } : { ok: true };
}

export async function cancelRequest(myId: string, requestId: string): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase
    .from("friend_requests")
    .delete()
    .eq("id", requestId)
    .eq("sender_id", myId)
    .eq("status", "pending");
  return error ? { ok: false, error: safeErrorMessage(error, "Could not cancel request.") } : { ok: true };
}

/** Unfriends — both rows, or the friendship would survive in one direction. */
export async function removeFriend(myId: string, friendId: string): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase
    .from("friends")
    .delete()
    .or(
      `and(user_id.eq.${myId},friend_id.eq.${friendId}),and(user_id.eq.${friendId},friend_id.eq.${myId})`
    );
  return error ? { ok: false, error: safeErrorMessage(error, "Could not remove friend.") } : { ok: true };
}

/**
 * Finds or creates the 1:1 conversation with a friend. `user_a` is always the
 * smaller id (the 23505 on the pair is the race guard), labels start as the
 * web's "Anonymous Friend", and a lost race re-reads the winner's row.
 */
export async function startChatWithFriend(
  myId: string,
  friendId: string
): Promise<{ ok: boolean; conversationId?: string; error?: string }> {
  const userA = myId < friendId ? myId : friendId;
  const userB = myId < friendId ? friendId : myId;

  const { data: existing, error: fetchError } = await supabase
    .from("conversations")
    .select("id")
    .eq("user_a", userA)
    .eq("user_b", userB)
    .maybeSingle();

  if (fetchError) return { ok: false, error: safeErrorMessage(fetchError, "Could not check for an existing conversation.") };
  if (existing) return { ok: true, conversationId: (existing as { id: string }).id };

  const { data: created, error: createError } = await supabase
    .from("conversations")
    .insert({
      user_a: userA,
      user_b: userB,
      user_a_label: "Anonymous Friend",
      user_b_label: "Anonymous Friend",
      last_message_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (createError) {
    if (createError.code === "23505") {
      const { data: raceRow, error: raceError } = await supabase
        .from("conversations")
        .select("id")
        .eq("user_a", userA)
        .eq("user_b", userB)
        .maybeSingle();
      if (raceError || !raceRow) {
        return { ok: false, error: safeErrorMessage(raceError || createError, "Could not start chat.") };
      }
      return { ok: true, conversationId: (raceRow as { id: string }).id };
    }
    return { ok: false, error: safeErrorMessage(createError, "Could not start chat.") };
  }

  return { ok: true, conversationId: (created as { id: string }).id };
}

/**
 * Opens the PENDING thread for a request you sent — rule (a) of the
 * friend-request messaging gates. `ensure_pending_conversation` (202609090002)
 * is the definer RPC that verifies the pending request and creates the row. A
 * pre-migration database has no function, in which case there is no
 * pending-thread support and the honest answer is a toast.
 */
export async function openPendingThread(
  profileId: string
): Promise<{ ok: boolean; conversationId?: string; error?: string; unsupported?: boolean }> {
  const { data: conversationId, error } = await supabase.rpc("ensure_pending_conversation", {
    target_user_id: profileId,
  });

  if (error) {
    if (error.code === "PGRST202" || /could not find the function/i.test(error.message)) {
      return { ok: false, unsupported: true, error: "Pending threads aren't available on this server yet." };
    }
    return { ok: false, error: safeErrorMessage(error, "Couldn't open the pending thread.") };
  }

  return { ok: true, conversationId: (conversationId as string | null) ?? undefined };
}

/** Looks a username up for "add by username". */
export async function fetchProfileByUsername(
  username: string
): Promise<FriendProfile | null> {
  const clean = username.trim().toLowerCase().replace(/^@/, "");
  if (!/^[a-z0-9_]{3,20}$/.test(clean)) return null;

  const { data } = await supabase
    .from("profiles")
    .select("id,username,display_name,avatar_url,bio,country_code")
    .eq("username", clean)
    .maybeSingle();

  return (data as FriendProfile | null) ?? null;
}
