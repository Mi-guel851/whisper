"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Check, Clock, Compass, Ghost, MessageCircle, Radar, UserPlus, Users, X } from "lucide-react";
import { motion } from "framer-motion";

import { supabase } from "@/lib/supabase/client";
import { safeErrorMessage } from "@/lib/safeErrorMessage";
import { presenceManager } from "@/lib/realtime/presence";
import { requireOnline } from "@/lib/offline";
import { COUNTRIES } from "@/lib/countries";
import BackButton from "@/components/BackButton";
import BottomNavigation from "@/components/BottomNavigation";
import Button from "@/components/Button";
import BrandedLoader from "@/components/BrandedLoader";
import GlassPanel from "@/components/GlassPanel";
import PersonRow from "@/components/PersonRow";
import RadarSweep from "@/components/RadarSweep";
import SegmentedTabs from "@/components/SegmentedTabs";
import EmptyState from "@/components/ui/EmptyState";
import type { SegmentedTab } from "@/components/SegmentedTabs";
import { useToast } from "@/components/ToastProvider";
import { useAnonNames } from "@/lib/anonNames";
import { generatedAvatarUrl } from "@/lib/generatedAvatar";
import { staggerContainer } from "@/lib/motion";

type FriendTab = "discover" | "requests" | "friends" | "active";
type RequestStatus = "pending" | "accepted" | "rejected" | "cancelled";

type ProfileSummary = { id: string };

type RawFriendRow = Omit<FriendRow, "friend"> & { friend: ProfileSummary | ProfileSummary[] | null };
type RawFriendRequestRow = Omit<FriendRequestRow, "sender" | "receiver"> & {
  sender: ProfileSummary | ProfileSummary[] | null;
  receiver: ProfileSummary | ProfileSummary[] | null;
};

type FriendRow = {
  id: string;
  user_id: string;
  friend_id: string;
  created_at: string;
  friend: ProfileSummary | null;
};

type FriendRequestRow = {
  id: string;
  sender_id: string;
  receiver_id: string;
  status: RequestStatus;
  created_at: string;
  updated_at: string;
  sender: ProfileSummary | null;
  receiver: ProfileSummary | null;
};

type RelatedUserIds = {
  friendIds: Set<string>;
  pendingIds: Set<string>;
  blockedUserIds: Set<string>;
};

type MatchCandidate = {
  profile_id: string;
  country_code: string | null;
  active_recent: boolean;
};

const PAGE_SIZE = 5;

/**
 * The radar sweep's run time. It is the MINIMUM perceived duration: the RPC
 * is fired in parallel with the sweep, and the list reveals once BOTH have
 * landed. A 200ms fetch under a 2.5s sweep is still 2.5s — the scan has to
 * feel like a sweep, and a scan that answers before it finishes moving reads
 * as a loading spinner that was dressed up.
 */
const SWEEP_MS = 2500;

/** The RPC's page size — "Scan again" advances one of these at a time. */
const MATCH_PAGE_SIZE = 20;

function regionLabel(countryCode: string | null | undefined) {
  if (!countryCode) return "Nearby";
  return COUNTRIES.find((country) => country.code === countryCode)?.name ?? "Nearby";
}

type MatchScanError = { code?: string; message?: string };

/**
 * Database diagnostics belong in the console, not in a user-facing toast.
 * Apart from being confusing, raw Postgres messages exposed implementation
 * details such as the function's return shape (the failure repaired in
 * 202609090006). Keep the handful of actionable cases specific and make every
 * other failure a stable retry message.
 */
function matchScanErrorMessage(error: MatchScanError) {
  if (error.code === "28000" || error.code === "PGRST301" || /jwt|not authenticated/i.test(error.message ?? "")) {
    return "Your session expired. Please sign in again.";
  }
  if (error.code === "PGRST202" || error.code === "42883" || /could not find the function/i.test(error.message ?? "")) {
    return "Find a Match is being updated. Please try again shortly.";
  }
  if (/fetch|network|connection/i.test(error.message ?? "")) {
    return "The scan couldn't connect. Check your connection and try again.";
  }
  return "We couldn't complete the scan. Please try again.";
}

function uniqueChannelName(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function normalizeTab(value: string | null): FriendTab {
  if (value === "requests") return "requests";
  if (value === "friends") return "friends";
  if (value === "active") return "active";
  return "discover";
}

function singleProfile<T extends ProfileSummary>(profile: T | T[] | null): T | null {
  return Array.isArray(profile) ? profile[0] ?? null : profile;
}

function normalizeFriendRows(rows: RawFriendRow[]): FriendRow[] {
  return rows.map((row) => ({ ...row, friend: singleProfile(row.friend) }));
}

function normalizeRequestRows(rows: RawFriendRequestRow[]): FriendRequestRow[] {
  return rows.map((row) => ({ ...row, sender: singleProfile(row.sender), receiver: singleProfile(row.receiver) }));
}

/**
 * A list surface for `PersonRow`s, with an empty state that fills the same
 * slot. Every tab on this screen renders one of these, so "no results" can't
 * drift into four different-looking blank panels.
 *
 * The panel is bare of padding on purpose: `empty` is an `EmptyState`, which
 * brings its own.
 */
function PersonList({
  children,
  empty,
  isEmpty,
}: {
  children: React.ReactNode;
  empty: React.ReactNode;
  isEmpty: boolean;
}) {
  if (isEmpty) {
    return <GlassPanel className="rounded-2xl">{empty}</GlassPanel>;
  }

  return (
    <motion.div
      className="person-list"
      variants={staggerContainer(0.05)}
      initial="hidden"
      animate="visible"
    >
      {children}
    </motion.div>
  );
}

function ActiveNowLabel() {
  return (
    <span className="inline-flex items-center gap-1.5 font-semibold" style={{ color: "var(--theme-success)" }}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: "var(--theme-success)" }} />
      Active now
    </span>
  );
}

function FriendsPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { showToast } = useToast();
  const [myId, setMyId] = useState("");
  const [loading, setLoading] = useState(true);
  const [discoverLoading, setDiscoverLoading] = useState(false);
  const [discoverPage, setDiscoverPage] = useState(0);
  const [hasMorePeople, setHasMorePeople] = useState(false);
  const [people, setPeople] = useState<ProfileSummary[]>([]);
  const [friends, setFriends] = useState<FriendRow[]>([]);
  const [incoming, setIncoming] = useState<FriendRequestRow[]>([]);
  const [outgoing, setOutgoing] = useState<FriendRequestRow[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [onlineUserIds, setOnlineUserIds] = useState<string[]>([]);

  /* Find a Match. `idle` → `scanning` (sweep on screen, RPC in flight) →
     `results` (ranked rows + Scan again). The page is 0-based and advances
     per rescan — the RPC's deterministic daily order makes paging stable
     within a day, so "Scan again" surfaces the NEXT twenty, not a reshuffle
     of the same twenty. */
  const [matchState, setMatchState] = useState<"idle" | "scanning" | "results">("idle");
  const [matchCandidates, setMatchCandidates] = useState<MatchCandidate[]>([]);
  const [matchPage, setMatchPage] = useState(0);
  const [matchHasMore, setMatchHasMore] = useState(false);
  /* My own self-declared region, so a candidate sharing it can be labelled
     "Your region" — the ranking is opaque numbers; the label is the part the
     reader actually checks. `undefined` means the one-row lookup is still in
     flight; `null` means it completed and this legacy profile has no country. */
  const [myCountryCode, setMyCountryCode] = useState<string | null | undefined>(undefined);

  const showSupabaseError = useCallback((fallback: string, error: { message?: string } | null | undefined) => {
    const message = error?.message?.trim() || fallback;
    console.error(fallback, error);
    showToast(message);
  }, [showToast]);

  const loadFriends = useCallback(async (userId: string) => {
    const { data, error } = await supabase
      .from("friends")
      .select("id,user_id,friend_id,created_at,friend:profiles!friends_friend_id_fkey(id)")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    if (error) { showSupabaseError("Could not load friends.", error); return; }
    setFriends(normalizeFriendRows((data || []) as unknown as RawFriendRow[]));
  }, [showSupabaseError]);

  const loadRequests = useCallback(async (userId: string) => {
    const requestSelect = "id,sender_id,receiver_id,status,created_at,updated_at,sender:profiles!friend_requests_sender_id_fkey(id),receiver:profiles!friend_requests_receiver_id_fkey(id)";
    const [incomingRes, outgoingRes] = await Promise.all([
      supabase.from("friend_requests").select(requestSelect).eq("receiver_id", userId).eq("status", "pending").order("created_at", { ascending: false }),
      supabase.from("friend_requests").select(requestSelect).eq("sender_id", userId).eq("status", "pending").order("created_at", { ascending: false }),
    ]);
    if (incomingRes.error) { showSupabaseError("Could not load incoming requests.", incomingRes.error); return; }
    if (outgoingRes.error) { showSupabaseError("Could not load outgoing requests.", outgoingRes.error); return; }
    setIncoming(normalizeRequestRows((incomingRes.data || []) as unknown as RawFriendRequestRow[]));
    setOutgoing(normalizeRequestRows((outgoingRes.data || []) as unknown as RawFriendRequestRow[]));
  }, [showSupabaseError]);

  const loadRelatedUserIds = useCallback(async (userId: string): Promise<RelatedUserIds> => {
    const [friendsRes, requestsRes, blockedRes] = await Promise.all([
      supabase.from("friends").select("friend_id").eq("user_id", userId),
      supabase.from("friend_requests").select("sender_id,receiver_id,status").or(`sender_id.eq.${userId},receiver_id.eq.${userId}`),
      supabase.from("blocked_users").select("user_id,blocked_user_id").or(`user_id.eq.${userId},blocked_user_id.eq.${userId}`),
    ]);
    if (friendsRes.error) showSupabaseError("Could not load existing friends.", friendsRes.error);
    if (requestsRes.error) showSupabaseError("Could not load related requests.", requestsRes.error);
    if (blockedRes.error) showSupabaseError("Could not load blocked users.", blockedRes.error);
    const friendIds = new Set((friendsRes.data || []).map((f) => f.friend_id as string));
    const pendingIds = new Set<string>();
    for (const r of (requestsRes.data || []) as { sender_id: string; receiver_id: string; status: RequestStatus }[]) {
      if (r.status !== "pending") continue;
      pendingIds.add(r.sender_id === userId ? r.receiver_id : r.sender_id);
    }
    const blockedUserIds = new Set((blockedRes.data || []).map((row) => (row.user_id === userId ? row.blocked_user_id : row.user_id)));
    return { friendIds, pendingIds, blockedUserIds };
  }, [showSupabaseError]);

  const loadPeople = useCallback(async (userId: string, page: number) => {
    setDiscoverLoading(true);
    const related = await loadRelatedUserIds(userId);
    const excluded = new Set([userId, ...related.friendIds, ...related.pendingIds, ...related.blockedUserIds]);
    const { data, error } = await supabase
      .from("profiles").select("id").order("id", { ascending: true })
      .range(0, Math.max((page + 1) * PAGE_SIZE * 4, PAGE_SIZE + 1));
    if (error) { showSupabaseError("Could not discover people.", error); setDiscoverLoading(false); return; }
    const visible = ((data || []) as ProfileSummary[]).filter((p) => !excluded.has(p.id));
    setPeople(visible.slice(0, (page + 1) * PAGE_SIZE));
    setHasMorePeople(visible.length > (page + 1) * PAGE_SIZE);
    setDiscoverLoading(false);
  }, [loadRelatedUserIds, showSupabaseError]);

  const refreshAll = useCallback(async (userId: string) => {
    await Promise.all([loadFriends(userId), loadRequests(userId), loadPeople(userId, discoverPage)]);
  }, [discoverPage, loadFriends, loadPeople, loadRequests]);

  useEffect(() => {
    let cancelled = false;
    let requestChannel: ReturnType<typeof supabase.channel> | null = null;
    let friendsChannel: ReturnType<typeof supabase.channel> | null = null;
    let unsubscribePresence: (() => void) | undefined;

    async function init() {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setLoading(false); return; }
      setMyId(session.user.id);
      /* My own region for the "Your region" label — one row, my own, and the
         only profile the radar needs from me. */
      void supabase
        .from("profiles")
        .select("country_code")
        .eq("id", session.user.id)
        .maybeSingle()
        .then(({ data, error }) => {
          /* A failed label lookup must not block the server-side scan. Leave the
             value `undefined` and let the RPC read the caller's profile itself. */
          if (!cancelled && !error) {
            setMyCountryCode((data as { country_code: string | null } | null)?.country_code ?? null);
          }
        });
      /* Listener first, then connect. Registering up front means the roster is
         applied whenever it arrives — including on a later automatic rebuild —
         instead of only if the first connect happened to succeed. The connect
         itself isn't awaited: presence is ambient, and blocking the page's data
         load on a WebSocket handshake is what made a slow network look like a
         hung screen. */
      unsubscribePresence = presenceManager.subscribe((users) => {
        if (!cancelled) setOnlineUserIds(users.map((u) => u.id));
      });
      void presenceManager.connect(session.user.id);
      await Promise.all([loadFriends(session.user.id), loadRequests(session.user.id), loadPeople(session.user.id, 0)]);
      if (cancelled) return;
      setLoading(false);
      requestChannel = supabase
        .channel(uniqueChannelName(`friend-requests-${session.user.id}`))
        .on("postgres_changes", { event: "*", schema: "public", table: "friend_requests" }, () => refreshAll(session.user.id))
        .subscribe();
      friendsChannel = supabase
        .channel(uniqueChannelName(`friends-${session.user.id}`))
        .on("postgres_changes", { event: "*", schema: "public", table: "friends", filter: `user_id=eq.${session.user.id}` }, () => refreshAll(session.user.id))
        .subscribe();
    }

    init();
    return () => {
      cancelled = true;
      unsubscribePresence?.();
      if (requestChannel) supabase.removeChannel(requestChannel);
      if (friendsChannel) supabase.removeChannel(friendsChannel);
    };
  }, [loadFriends, loadPeople, loadRequests, refreshAll]);

  const tab = normalizeTab(searchParams.get("tab"));

  const friendIdSet = useMemo(
    () => new Set(friends.map((friend) => friend.friend_id)),
    [friends]
  );

  /* Requests in either direction. Both count as "already handled" for the
     purposes of the Active tab's action button — an outgoing one is awaiting
     them, an incoming one is awaiting you on the Requests tab, and neither
     should offer Add Friend a second time. */
  const pendingIdSet = useMemo(() => {
    const ids = new Set<string>();
    for (const request of outgoing) ids.add(request.receiver_id);
    for (const request of incoming) ids.add(request.sender_id);
    return ids;
  }, [outgoing, incoming]);

  /* `onlineUserIds.includes(id)` was the per-row online check in four places,
     each a linear scan of the online list for every row rendered. Presence
     pushes a fresh array whenever anyone anywhere connects or disconnects, so
     that ran on every row on every presence event — O(rows × online) per tick,
     across four lists. One Set makes each check a hash lookup. */
  const onlineSet = useMemo(() => new Set(onlineUserIds), [onlineUserIds]);

  /* Everyone online but me.

     This used to also exclude friends, on the reasoning that a friend belongs
     on the Friends tab. But the people actually online are overwhelmingly the
     ones you've already added, so the filter removed most of its own input and
     the tab read as empty even with a room full of users. "Active now" means
     active now — the row's action just changes: Message someone you've added,
     Add Friend for anyone else. */
  const activeNow = useMemo(
    () => onlineUserIds.filter((id) => id !== myId),
    [onlineUserIds, myId]
  );

  /* Every id any tab on this screen can render, resolved in one batch. All four
     lists go through one request rather than one per list, and switching tabs
     costs nothing because the names are already cached. */
  const anonymousName = useAnonNames(
    useMemo(
      () => [
        ...people.map((profile) => profile.id),
        ...activeNow,
        ...friends.map((friend) => friend.friend_id),
        ...matchCandidates.map((candidate) => candidate.profile_id),
      ],
      [people, activeNow, friends, matchCandidates]
    )
  );

  // The count lives on the tab as a badge, not baked into the label string —
  // a label that changes width every time someone comes online re-lays out the
  // whole control mid-animation.
  const tabs: SegmentedTab<FriendTab>[] = [
    { value: "discover", label: "Discover" },
    { value: "active", label: "Active", badge: activeNow.length },
    { value: "requests", label: "Requests", badge: incoming.length },
    { value: "friends", label: "Friends" },
  ];

  function setActiveTab(nextTab: FriendTab) {
    router.replace(`/friends${nextTab === "discover" ? "" : `?tab=${nextTab}`}`);
  }

  async function showMorePeople() {
    if (!myId) return;
    const nextPage = discoverPage + 1;
    setDiscoverPage(nextPage);
    await loadPeople(myId, nextPage);
  }

  /**
   * Runs one radar sweep: the animation is the floor, the RPC is the data.
   *
   * The offline refusal comes from lib/offline.ts like every other
   * cannot-work-offline action here — a scan that would quietly queue and
   * complete later, against a candidate pool that has moved on, is worse
   * than one that plainly did not happen.
   *
   * Backend failures are logged with their diagnostic details, but the toast
   * stays actionable and never exposes raw Postgres internals. Every failure
   * returns the section to idle so nothing is left half-open.
   */
  async function runMatchScan(page: number) {
    if (!myId) return;
    if (!requireOnline(showToast, "Scanning")) return;
    if (myCountryCode === null) {
      showToast("Add your country to your profile before scanning for a match.");
      return;
    }

    setMatchState("scanning");

    try {
      const rpcPromise = supabase.rpc("find_match_candidates", { p_page: page });
      const sweepWait = new Promise<void>((resolve) => setTimeout(resolve, SWEEP_MS));
      const rpc = await Promise.all([rpcPromise, sweepWait]).then(([result]) => result);

      if (rpc.error) {
        console.error("Find a Match scan failed:", rpc.error);
        showToast(matchScanErrorMessage(rpc.error));
        setMatchState("idle");
        return;
      }

      /* Treat the network response as data rather than trusting a TypeScript
         assertion. A malformed row is skipped, so one bad result cannot crash
         the whole Friends screen while React tries to key/render it. */
      const rows = (Array.isArray(rpc.data) ? rpc.data : []).filter(
        (row): row is MatchCandidate =>
          Boolean(row) && typeof row === "object" && typeof (row as MatchCandidate).profile_id === "string"
      );
      setMatchCandidates(rows);
      setMatchHasMore(rows.length === MATCH_PAGE_SIZE);
      setMatchPage(page);
      setMatchState("results");
    } catch (error) {
      const scanError = error instanceof Error ? { message: error.message } : {};
      console.error("Find a Match scan failed before receiving a response:", error);
      showToast(matchScanErrorMessage(scanError));
      setMatchState("idle");
    }
  }

  async function addFriend(profileId: string) {
    if (!myId) { showToast("Authentication missing. Please sign in again."); return; }
    if (profileId === myId) { showToast("You cannot send a friend request to yourself."); return; }
    setBusyId(profileId);
    const { data: existing, error: existingError } = await supabase
      .from("friend_requests").select("id,sender_id,receiver_id,status")
      .or(`and(sender_id.eq.${myId},receiver_id.eq.${profileId}),and(sender_id.eq.${profileId},receiver_id.eq.${myId})`)
      .eq("status", "pending").maybeSingle();
    if (existingError) { showSupabaseError("Could not check for an existing request.", existingError); await refreshAll(myId); setBusyId(null); return; }
    if (existing) { showToast("A friend request already exists between you two."); await refreshAll(myId); setBusyId(null); return; }
    const { error } = await supabase.from("friend_requests").insert({ sender_id: myId, receiver_id: profileId, status: "pending" });
    if (error) {
      if (error.code === "23505") showToast("A friend request already exists between you two.");
      else showSupabaseError("Friend request failed.", error);
    } else {
      setPeople((prev) => prev.filter((p) => p.id !== profileId));
      showToast("Friend request sent.");
      /* Push is sent by `friend_request_event_trigger` + 202608190003. The
         invoke that was here passed `id: crypto.randomUUID()` — a fabricated id
         for a row that had just been inserted with a real one — and it fired
         only when this tab stayed open long enough to complete. */
    }
    await refreshAll(myId);
    setBusyId(null);
  }

  async function acceptRequest(requestId: string) {
    if (!myId) return;
    setBusyId(requestId);
    const { data: requestRow, error: fetchError } = await supabase
      .from("friend_requests").select("id,sender_id,receiver_id,status")
      .eq("id", requestId).eq("receiver_id", myId).eq("status", "pending").maybeSingle();
    if (fetchError) { showSupabaseError("Could not load this request.", fetchError); await refreshAll(myId); setBusyId(null); return; }
    if (!requestRow) { showToast("This request is no longer available."); await refreshAll(myId); setBusyId(null); return; }
    const { error: updateError } = await supabase.from("friend_requests")
      .update({ status: "accepted", updated_at: new Date().toISOString() })
      .eq("id", requestId).eq("receiver_id", myId).eq("status", "pending");
    if (updateError) { showSupabaseError("Could not accept request.", updateError); await refreshAll(myId); setBusyId(null); return; }
    const { error: friendError } = await supabase.from("friends")
      .insert({ user_id: myId, friend_id: requestRow.sender_id, source: "request" });
    if (friendError && friendError.code !== "23505") showSupabaseError("Request accepted, but adding the friend failed.", friendError);
    else showToast("Friend added.");
    /* The reverse row, so both people's Friends tabs list the friendship.
       The send gate (202609090002) matches a friendship in either direction,
       so a rejection here degrades to the old one-directional behaviour
       rather than breaking the conversation — which matters because some
       databases' insert policy only admits the caller's own row. */
    const { error: reverseError } = await supabase.from("friends")
      .insert({ user_id: requestRow.sender_id, friend_id: myId, source: "request" });
    if (reverseError && reverseError.code !== "23505") {
      console.warn("Reverse friendship row not written (policy likely owner-only):", reverseError.message);
    }
    /* The acceptance push comes from the same trigger, which fires on UPDATE as
       well as INSERT — the status change above is what it reacts to. */
    await refreshAll(myId);
    setBusyId(null);
  }

  async function declineRequest(requestId: string) {
    if (!myId) return;
    setBusyId(requestId);
    const { error } = await supabase.from("friend_requests").delete().eq("id", requestId).eq("receiver_id", myId).eq("status", "pending");
    if (error) showSupabaseError("Could not decline request.", error);
    else showToast("Request declined.");
    await refreshAll(myId);
    setBusyId(null);
  }

  async function cancelRequest(requestId: string) {
    if (!myId) return;
    setBusyId(requestId);
    const { error } = await supabase.from("friend_requests").delete().eq("id", requestId).eq("sender_id", myId).eq("status", "pending");
    if (error) showSupabaseError("Could not cancel request.", error);
    else showToast("Request cancelled.");
    await refreshAll(myId);
    setBusyId(null);
  }

  async function startChat(friendId: string) {
    if (!myId) return;
    setBusyId(friendId);
    const userA = myId < friendId ? myId : friendId;
    const userB = myId < friendId ? friendId : myId;
    const { data: existing, error: fetchError } = await supabase.from("conversations").select("id").eq("user_a", userA).eq("user_b", userB).maybeSingle();
    if (fetchError) { showSupabaseError("Could not check for an existing conversation.", fetchError); setBusyId(null); return; }
    if (existing) { router.push(`/chat/${existing.id}`); setBusyId(null); return; }
    const { data: created, error: createError } = await supabase.from("conversations")
      .insert({ user_a: userA, user_b: userB, user_a_label: "Anonymous Friend", user_b_label: "Anonymous Friend", last_message_at: new Date().toISOString() })
      .select("id").single();
    if (createError) {
      if (createError.code === "23505") {
        const { data: raceRow, error: raceError } = await supabase.from("conversations").select("id").eq("user_a", userA).eq("user_b", userB).maybeSingle();
        if (raceError || !raceRow) { showSupabaseError("Could not start chat.", raceError || createError); setBusyId(null); return; }
        router.push(`/chat/${raceRow.id}`); setBusyId(null); return;
      }
      showSupabaseError("Could not start chat.", createError); setBusyId(null); return;
    }
    if (created) router.push(`/chat/${created.id}`);
    setBusyId(null);
  }

  /**
   * Opens the PENDING thread for a request you sent — rule (a) of the
   * friend-request messaging gates. The pair is not friends yet, so the
   * thread can't go through startChat's assumptions; `ensure_pending_conversation`
   * (202609090002) is the definer RPC that verifies the pending request and
   * creates the row. A pre-migration database has no function, in which case
   * there is no pending-thread support at all and the honest answer is a
   * toast, not a half-opened thread.
   */
  async function openPendingThread(profileId: string) {
    if (!myId) return;
    setBusyId(profileId);
    const { data: conversationId, error } = await supabase.rpc("ensure_pending_conversation", {
      target_user_id: profileId,
    });
    if (error) {
      if (error.code === "PGRST202" || /could not find the function/i.test(error.message)) {
        showToast("Pending threads aren't available on this server yet.");
      } else {
        showToast(safeErrorMessage(error, "Couldn't open the pending thread."));
      }
      setBusyId(null);
      return;
    }
    if (conversationId) router.push(`/chat/${conversationId}`);
    setBusyId(null);
  }

  if (loading) return <BrandedLoader label="Finding people" />;

  return (
    <main className="min-h-screen theme-bg-gradient pb-28 text-white">
      <div className="mx-auto max-w-2xl px-6 py-8">
        <BackButton />
        <div className="mt-4 flex items-center gap-3">
          <Users className="text-purple-400" size={24} />
          <h1 className="page-title">Discover People</h1>
        </div>
        <p className="page-subtitle mt-2">Meet registered Whisper users anonymously.</p>

        <SegmentedTabs
          className="mt-6"
          label="Friends sections"
          tabs={tabs}
          value={tab}
          onChange={setActiveTab}
        />

        {/* ── Find a Match ──
            A scan action, not a fifth tab: the four tabs above are stable
            lists, and a radar is a *moment* — tap it, watch it sweep, read
            what it finds, scan again or walk away. Tucking it into the
            segmented control would make a one-shot gesture look like a
            permanent section. */}
        <section className="mt-4">
          {matchState === "idle" && (
            <GlassPanel strong className="rounded-3xl p-5">
              <div className="flex items-center gap-3.5">
                <span
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl"
                  style={{
                    background:
                      "linear-gradient(135deg, color-mix(in srgb, #22d3ee 18%, transparent), color-mix(in srgb, #a855f7 18%, transparent))",
                    color: "var(--theme-accent-from)",
                  }}
                >
                  <Radar size={22} />
                </span>
                <div className="min-w-0 flex-1">
                  <h2 className="card-title">Find a Match</h2>
                  <p className="truncate text-xs theme-text-muted">
                    Sweep for people in your region who are active — your chosen country only, never a location.
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => runMatchScan(0)}
                  icon={<Radar size={15} />}
                >
                  Scan
                </Button>
              </div>
            </GlassPanel>
          )}

          {matchState === "scanning" && (
            <GlassPanel strong className="rounded-3xl p-6">
              <RadarSweep durationMs={SWEEP_MS} />
            </GlassPanel>
          )}

          {matchState === "results" && (
            <div className="space-y-3">
              <div className="flex items-center justify-between px-1">
                <h2 className="section-title">Matches on this sweep</h2>
                <Button size="sm" variant="ghost" onClick={() => setMatchState("idle")}>
                  Close
                </Button>
              </div>

              <PersonList
                isEmpty={matchCandidates.length === 0}
                empty={
                  <EmptyState
                    icon={<Radar size={26} />}
                    title="No matches on this sweep"
                    description="Everyone who fits is already a friend, has a request in flight, or has opted out of the radar. New people show up as they join and set their country."
                  />
                }
              >
                {matchCandidates.map((candidate) => {
                  const online = onlineSet.has(candidate.profile_id);
                  const sameRegion = Boolean(myCountryCode) && candidate.country_code === myCountryCode;
                  return (
                    <PersonRow
                      key={candidate.profile_id}
                      avatarUrl={generatedAvatarUrl(candidate.profile_id)}
                      name={anonymousName(candidate.profile_id)}
                      online={online}
                      subtitle={
                        <span className="inline-flex items-center gap-1.5">
                          <span>{regionLabel(candidate.country_code)}</span>
                          {sameRegion && (
                            <span
                              className="rounded-full px-1.5 py-0.5 text-[10px] font-bold"
                              style={{
                                background: "color-mix(in srgb, #22d3ee 18%, transparent)",
                                color: "#22d3ee",
                              }}
                            >
                              Your region
                            </span>
                          )}
                          {candidate.active_recent && (
                            <span className="font-semibold" style={{ color: "var(--theme-success)" }}>
                              · Active recently
                            </span>
                          )}
                        </span>
                      }
                      actions={
                        <Button
                          size="sm"
                          variant="primary"
                          loading={busyId === candidate.profile_id}
                          onClick={() => addFriend(candidate.profile_id)}
                          icon={<UserPlus size={15} />}
                        >
                          Add Friend
                        </Button>
                      }
                    />
                  );
                })}
              </PersonList>

              {matchHasMore && (
                <Button variant="secondary" fullWidth onClick={() => runMatchScan(matchPage + 1)}>
                  Scan again
                </Button>
              )}
            </div>
          )}
        </section>

        {/* ── Discover ── */}
        {tab === "discover" && (
          <section className="mt-6 space-y-3">
            <PersonList
              isEmpty={people.length === 0}
              empty={
                <EmptyState
                  icon={<Compass size={26} />}
                  title="No one new right now"
                  description="You have reached everyone on Whisper for now. New people show up here as they join."
                />
              }
            >
              {people.map((profile) => {
                const online = onlineSet.has(profile.id);
                return (
                  <PersonRow
                    key={profile.id}
                    avatarUrl={generatedAvatarUrl(profile.id)}
                    name={anonymousName(profile.id)}
                    online={online}
                    subtitle={online ? <ActiveNowLabel /> : "Anonymous Whisper user"}
                    actions={
                      <Button
                        size="sm"
                        variant="primary"
                        loading={busyId === profile.id}
                        onClick={() => addFriend(profile.id)}
                        icon={<UserPlus size={15} />}
                      >
                        Add Friend
                      </Button>
                    }
                  />
                );
              })}
            </PersonList>

            {hasMorePeople && (
              <Button
                variant="secondary"
                fullWidth
                loading={discoverLoading}
                onClick={showMorePeople}
              >
                Show more people
              </Button>
            )}
          </section>
        )}

        {/* ── Active ── */}
        {tab === "active" && (
          <section className="mt-6">
            <div className="mb-3 flex items-center gap-2">
              <span
                className="h-2 w-2 animate-pulse rounded-full"
                style={{ background: "var(--theme-success)" }}
              />
              <h2 className="eyebrow" style={{ color: "var(--theme-success)" }}>
                Online right now
              </h2>
              <span
                className="rounded-full px-2 py-0.5 text-xs font-bold tabular-nums"
                style={{
                  background: "color-mix(in srgb, var(--theme-success) 20%, transparent)",
                  color: "var(--theme-success)",
                }}
              >
                {activeNow.length}
              </span>
            </div>

            <PersonList
              isEmpty={activeNow.length === 0}
              empty={
                <EmptyState
                  icon={<Ghost size={26} />}
                  title="No one else is online"
                  description="Active friends appear here the moment they open Whisper. Check back soon."
                />
              }
            >
              {activeNow.map((id) => {
                const isFriend = friendIdSet.has(id);
                const isPending = pendingIdSet.has(id);

                return (
                  <PersonRow
                    key={id}
                    avatarUrl={generatedAvatarUrl(id)}
                    name={anonymousName(id)}
                    online
                    subtitle={<ActiveNowLabel />}
                    actions={
                      isFriend ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          loading={busyId === id}
                          onClick={() => startChat(id)}
                          icon={<MessageCircle size={15} />}
                        >
                          Message
                        </Button>
                      ) : isPending ? (
                        /* Requested already — shown disabled rather than hidden,
                           so the row doesn't vanish the moment you tap it. */
                        <Button size="sm" variant="ghost" disabled>
                          Pending
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="primary"
                          loading={busyId === id}
                          onClick={() => addFriend(id)}
                          icon={<UserPlus size={15} />}
                        >
                          Add Friend
                        </Button>
                      )
                    }
                  />
                );
              })}
            </PersonList>
          </section>
        )}

        {/* ── Requests ── */}
        {tab === "requests" && (
          <section className="mt-6 space-y-6">
            <RequestList title="Requests" empty="No incoming requests" requests={incoming} mode="incoming" busyId={busyId} onAccept={acceptRequest} onDecline={declineRequest} onCancel={cancelRequest} onMessage={openPendingThread} onlineSet={onlineSet} />
            <RequestList title="Sent requests" empty="No sent requests" requests={outgoing} mode="outgoing" busyId={busyId} onAccept={acceptRequest} onDecline={declineRequest} onCancel={cancelRequest} onMessage={openPendingThread} onlineSet={onlineSet} />
          </section>
        )}

        {/* ── Friends ── */}
        {tab === "friends" && (
          <section className="mt-6">
            <PersonList
              isEmpty={friends.length === 0}
              empty={
                <EmptyState
                  icon={<Users size={26} />}
                  title="No friends yet"
                  description="Add someone from Discover and you can chat privately, without either of you giving up a name."
                  action={{ label: "Open Discover", onClick: () => setActiveTab("discover") }}
                />
              }
            >
              {friends.map((friend) => (
                <PersonRow
                  key={friend.id}
                  avatarUrl={generatedAvatarUrl(friend.friend_id)}
                  name={anonymousName(friend.friend_id)}
                  online={onlineSet.has(friend.friend_id)}
                  subtitle={
                    onlineSet.has(friend.friend_id) ? <ActiveNowLabel /> : "Friend"
                  }
                  actions={
                    <Button
                      size="sm"
                      variant="secondary"
                      loading={busyId === friend.friend_id}
                      onClick={() => startChat(friend.friend_id)}
                      icon={<MessageCircle size={15} />}
                    >
                      Message
                    </Button>
                  }
                />
              ))}
            </PersonList>
          </section>
        )}
      </div>
      <BottomNavigation />
    </main>
  );
}

function RequestList({ title, empty, requests, mode, busyId, onAccept, onDecline, onCancel, onMessage, onlineSet }: {
  title: string; empty: string; requests: FriendRequestRow[]; mode: "incoming" | "outgoing";
  busyId: string | null; onAccept: (id: string) => void; onDecline: (id: string) => void; onCancel: (id: string) => void; onMessage: (profileId: string) => void; onlineSet: ReadonlySet<string>;
}) {
  /* Its own batch rather than a prop threaded down from the page: the resolver
     caches per tab-lifetime, so asking twice for the same id costs one map
     lookup and no second request. */
  const anonymousName = useAnonNames(
    useMemo(
      () =>
        requests.map((request) =>
          mode === "incoming" ? request.sender_id : request.receiver_id
        ),
      [requests, mode]
    )
  );

  return (
    <div>
      <h2 className="section-title mb-3">{title}</h2>
      <PersonList
        isEmpty={requests.length === 0}
        empty={
          <EmptyState
            icon={mode === "incoming" ? <UserPlus size={26} /> : <Clock size={26} />}
            title={empty}
            description={
              mode === "incoming"
                ? "When someone asks to be friends, their request lands here for you to accept."
                : "Requests you send stay here until they are accepted, so you can always cancel one."
            }
            className="py-8"
          />
        }
      >
        {requests.map((request) => {
          const profileId = mode === "incoming" ? request.sender_id : request.receiver_id;
          const busy = busyId === request.id;
          return (
            <PersonRow
              key={request.id}
              avatarUrl={generatedAvatarUrl(profileId)}
              name={anonymousName(profileId)}
              online={onlineSet.has(profileId)}
              subtitle={mode === "incoming" ? "Wants to be friends" : "Request pending"}
              actions={
                mode === "incoming" ? (
                  <>
                    <Button
                      size="sm"
                      variant="success"
                      loading={busy}
                      onClick={() => onAccept(request.id)}
                      icon={<Check size={15} />}
                    >
                      Accept
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => onDecline(request.id)}
                      aria-label={`Decline request from ${anonymousName(profileId)}`}
                    >
                      <X size={17} />
                    </Button>
                  </>
                ) : (
                  <>
                    <span
                      className="flex items-center gap-1 text-xs font-semibold"
                      style={{ color: "var(--theme-warning)" }}
                    >
                      <Clock size={14} />
                      Pending
                    </span>
                    {/* The pending thread: you may message first (after the
                        one-time coin unlock, like any chat); they may not
                        reply until they accept. The button opens the thread
                        through ensure_pending_conversation. */}
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={busy}
                      onClick={() => onMessage(profileId)}
                      icon={<MessageCircle size={15} />}
                    >
                      Message
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      loading={busy}
                      onClick={() => onCancel(request.id)}
                    >
                      Cancel
                    </Button>
                  </>
                )
              }
            />
          );
        })}
      </PersonList>
    </div>
  );
}

export default function FriendsPage() {
  return (
    <Suspense fallback={<BrandedLoader label="Finding people" />}>
      <FriendsPageContent />
    </Suspense>
  );
}