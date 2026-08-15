"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Check, Clock, MessageCircle, UserPlus, Users, X } from "lucide-react";
import { motion } from "framer-motion";

import { supabase } from "@/lib/supabase/client";
import { presenceManager } from "@/lib/realtime/presence";
import BackButton from "@/components/BackButton";
import BottomNavigation from "@/components/BottomNavigation";
import Button from "@/components/Button";
import BrandedLoader from "@/components/BrandedLoader";
import GlassPanel from "@/components/GlassPanel";
import PersonRow from "@/components/PersonRow";
import SegmentedTabs from "@/components/SegmentedTabs";
import type { SegmentedTab } from "@/components/SegmentedTabs";
import { useToast } from "@/components/ToastProvider";
import { anonymousDisplayName as anonymousName } from "@/lib/anonymousIdentity";
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

const PAGE_SIZE = 5;

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
    return (
      <GlassPanel className="rounded-2xl px-6 py-10 text-center">
        {empty}
      </GlassPanel>
    );
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
      supabase.functions.invoke("notify-friend-request", { body: { record: { receiver_id: profileId, sender_id: myId, id: crypto.randomUUID() }, type: "INSERT" } }).catch(console.error);
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
    supabase.functions.invoke("notify-friend-request", { body: { record: { sender_id: requestRow.sender_id, receiver_id: myId, id: requestId, status: "accepted" }, type: "UPDATE" } }).catch(console.error);
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

        {/* ── Discover ── */}
        {tab === "discover" && (
          <section className="mt-6 space-y-3">
            <PersonList
              isEmpty={people.length === 0}
              empty={
                <>
                  <p className="card-title">No one new right now</p>
                  <p className="mt-1 text-sm theme-text-muted">
                    You have already reached everyone on Whisper. Check back soon.
                  </p>
                </>
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
                <>
                  <p className="mb-2 text-2xl">👻</p>
                  <p className="card-title">No one else is online</p>
                  <p className="mt-1 text-sm theme-text-muted">Check back soon.</p>
                </>
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
            <RequestList title="Requests" empty="No incoming requests." requests={incoming} mode="incoming" busyId={busyId} onAccept={acceptRequest} onDecline={declineRequest} onCancel={cancelRequest} onlineSet={onlineSet} />
            <RequestList title="Sent requests" empty="No sent requests." requests={outgoing} mode="outgoing" busyId={busyId} onAccept={acceptRequest} onDecline={declineRequest} onCancel={cancelRequest} onlineSet={onlineSet} />
          </section>
        )}

        {/* ── Friends ── */}
        {tab === "friends" && (
          <section className="mt-6">
            <PersonList
              isEmpty={friends.length === 0}
              empty={
                <>
                  <p className="card-title">No friends yet</p>
                  <p className="mt-1 text-sm theme-text-muted">
                    Add someone from Discover to start a private chat.
                  </p>
                </>
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

function RequestList({ title, empty, requests, mode, busyId, onAccept, onDecline, onCancel, onlineSet }: {
  title: string; empty: string; requests: FriendRequestRow[]; mode: "incoming" | "outgoing";
  busyId: string | null; onAccept: (id: string) => void; onDecline: (id: string) => void; onCancel: (id: string) => void; onlineSet: ReadonlySet<string>;
}) {
  return (
    <div>
      <h2 className="section-title mb-3">{title}</h2>
      <PersonList
        isEmpty={requests.length === 0}
        empty={<p className="text-sm theme-text-muted">{empty}</p>}
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