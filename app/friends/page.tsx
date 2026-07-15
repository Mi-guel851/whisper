"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Check, Clock, MessageCircle, UserPlus, Users, X } from "lucide-react";

import { supabase } from "@/lib/supabase/client";
import { presenceManager } from "@/lib/realtime/presence";
import BackButton from "@/components/BackButton";
import BottomNavigation from "@/components/BottomNavigation";
import GlassPanel from "@/components/GlassPanel";
import { useToast } from "@/components/ToastProvider";
import { hashUserId, anonymousDisplayName as anonymousName } from "@/lib/anonymousIdentity";

type FriendTab = "discover" | "requests" | "friends";
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

const tabs: { value: FriendTab; label: string }[] = [
  { value: "discover", label: "Discover" },
  { value: "requests", label: "Requests" },
  { value: "friends", label: "Friends" },
];

function uniqueChannelName(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function normalizeTab(value: string | null): FriendTab {
  return value === "requests" || value === "friends" ? value : "discover";
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

function AnonymousAvatar({ userId, online = false }: { userId?: string | null; online?: boolean }) {
  const hash = hashUserId(userId || "ghost");
  const gradients = [
    "from-cyan-500 to-purple-600",
    "from-fuchsia-500 to-indigo-600",
    "from-emerald-400 to-cyan-600",
    "from-amber-300 to-rose-500",
    "from-slate-400 to-violet-700",
  ];
  return (
    <div className="relative shrink-0">
      <div className={`flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br ${gradients[hash % gradients.length]} text-lg font-black text-white`}>
        👻
      </div>
      {online && (
        <span className="absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-2 border-[#05010F] bg-green-500 shadow-[0_0_0_2px_rgba(0,0,0,0.15)]" />
      )}
    </div>
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

    if (error) {
      showSupabaseError("Could not load friends.", error);
      return;
    }

    setFriends(normalizeFriendRows((data || []) as unknown as RawFriendRow[]));
  }, [showSupabaseError]);

  const loadRequests = useCallback(async (userId: string) => {
    const requestSelect = "id,sender_id,receiver_id,status,created_at,updated_at,sender:profiles!friend_requests_sender_id_fkey(id),receiver:profiles!friend_requests_receiver_id_fkey(id)";
    const [incomingRes, outgoingRes] = await Promise.all([
      supabase.from("friend_requests").select(requestSelect).eq("receiver_id", userId).eq("status", "pending").order("created_at", { ascending: false }),
      supabase.from("friend_requests").select(requestSelect).eq("sender_id", userId).eq("status", "pending").order("created_at", { ascending: false }),
    ]);

    if (incomingRes.error) {
      showSupabaseError("Could not load incoming requests.", incomingRes.error);
      return;
    }
    if (outgoingRes.error) {
      showSupabaseError("Could not load outgoing requests.", outgoingRes.error);
      return;
    }

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

    const friendIds = new Set((friendsRes.data || []).map((friend) => friend.friend_id as string));
    const pendingIds = new Set<string>();
    for (const request of (requestsRes.data || []) as { sender_id: string; receiver_id: string; status: RequestStatus }[]) {
      if (request.status !== "pending") continue;
      pendingIds.add(request.sender_id === userId ? request.receiver_id : request.sender_id);
    }
    const blockedUserIds = new Set((blockedRes.data || []).map((row) => (row.user_id === userId ? row.blocked_user_id : row.user_id)));

    return { friendIds, pendingIds, blockedUserIds };
  }, [showSupabaseError]);

  const loadPeople = useCallback(async (userId: string, page: number) => {
    setDiscoverLoading(true);
    const related = await loadRelatedUserIds(userId);
    const excluded = new Set([userId, ...related.friendIds, ...related.pendingIds, ...related.blockedUserIds]);
    const { data, error } = await supabase
      .from("profiles")
      .select("id")
      .order("id", { ascending: true })
      .range(0, Math.max((page + 1) * PAGE_SIZE * 4, PAGE_SIZE + 1));

    if (error) {
      showSupabaseError("Could not discover people.", error);
      setDiscoverLoading(false);
      return;
    }

    const visible = ((data || []) as ProfileSummary[]).filter((profile) => !excluded.has(profile.id));
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
      if (!session) {
        setLoading(false);
        return;
      }

      setMyId(session.user.id);
      await presenceManager.connect(session.user.id);
      unsubscribePresence = presenceManager.subscribe((users) => {
        if (!cancelled) setOnlineUserIds(users.map((user) => user.id));
      });

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

  async function showMorePeople() {
    if (!myId) return;
    const nextPage = discoverPage + 1;
    setDiscoverPage(nextPage);
    await loadPeople(myId, nextPage);
  }

  function setActiveTab(nextTab: FriendTab) {
    router.replace(`/friends${nextTab === "discover" ? "" : `?tab=${nextTab}`}`);
  }

  async function addFriend(profileId: string) {
    if (!myId) {
      showToast("Authentication missing. Please sign in again.");
      return;
    }
    if (profileId === myId) {
      showToast("You cannot send a friend request to yourself.");
      return;
    }
    setBusyId(profileId);

    const { data: existing, error: existingError } = await supabase
      .from("friend_requests")
      .select("id,sender_id,receiver_id,status")
      .or(`and(sender_id.eq.${myId},receiver_id.eq.${profileId}),and(sender_id.eq.${profileId},receiver_id.eq.${myId})`)
      .eq("status", "pending")
      .maybeSingle();

    if (existingError) {
      showSupabaseError("Could not check for an existing request.", existingError);
      await refreshAll(myId);
      setBusyId(null);
      return;
    }

    if (existing) {
      showToast("A friend request already exists between you two.");
      await refreshAll(myId);
      setBusyId(null);
      return;
    }

    const { error } = await supabase.from("friend_requests").insert({
      sender_id: myId,
      receiver_id: profileId,
      status: "pending",
    });

    if (error) {
      if (error.code === "23505") {
        showToast("A friend request already exists between you two.");
      } else {
        showSupabaseError("Friend request failed.", error);
      }
    } else {
      setPeople((prev) => prev.filter((profile) => profile.id !== profileId));
      showToast("Friend request sent.");
    }
    await refreshAll(myId);
    setBusyId(null);
  }

  async function acceptRequest(requestId: string) {
    if (!myId) return;
    setBusyId(requestId);

    const { data: requestRow, error: fetchError } = await supabase
      .from("friend_requests")
      .select("id,sender_id,receiver_id,status")
      .eq("id", requestId)
      .eq("receiver_id", myId)
      .eq("status", "pending")
      .maybeSingle();

    if (fetchError) {
      showSupabaseError("Could not load this request.", fetchError);
      await refreshAll(myId);
      setBusyId(null);
      return;
    }

    if (!requestRow) {
      showToast("This request is no longer available.");
      await refreshAll(myId);
      setBusyId(null);
      return;
    }

    const { error: updateError } = await supabase
      .from("friend_requests")
      .update({ status: "accepted", updated_at: new Date().toISOString() })
      .eq("id", requestId)
      .eq("receiver_id", myId)
      .eq("status", "pending");

    if (updateError) {
      showSupabaseError("Could not accept request.", updateError);
      await refreshAll(myId);
      setBusyId(null);
      return;
    }

    const { error: friendError } = await supabase
      .from("friends")
      .insert({ user_id: myId, friend_id: requestRow.sender_id, source: "request" });

    if (friendError && friendError.code !== "23505") {
      showSupabaseError("Request accepted, but adding the friend failed.", friendError);
    } else {
      showToast("Friend added.");
    }

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

    const { data: existing, error: fetchError } = await supabase
      .from("conversations")
      .select("id")
      .eq("user_a", userA)
      .eq("user_b", userB)
      .maybeSingle();

    if (fetchError) {
      showSupabaseError("Could not check for an existing conversation.", fetchError);
      setBusyId(null);
      return;
    }

    if (existing) {
      router.push(`/chat/${existing.id}`);
      setBusyId(null);
      return;
    }

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
          showSupabaseError("Could not start chat.", raceError || createError);
          setBusyId(null);
          return;
        }

        router.push(`/chat/${raceRow.id}`);
        setBusyId(null);
        return;
      }

      showSupabaseError("Could not start chat.", createError);
      setBusyId(null);
      return;
    }

    if (created) router.push(`/chat/${created.id}`);
    setBusyId(null);
  }

  if (loading) return <main className="flex min-h-screen items-center justify-center theme-bg-gradient text-white">Loading...</main>;

  return (
    <main className="min-h-screen theme-bg-gradient pb-28 text-white">
      <div className="mx-auto max-w-2xl px-6 py-8">
        <BackButton />
        <div className="mt-4 flex items-center gap-3">
          <Users className="text-cyan-300" size={28} />
          <h1 className="text-3xl font-black">Discover People</h1>
        </div>
        <p className="mt-2 text-sm text-gray-400">Meet registered Whisper users anonymously. Names are generated and never reveal identity.</p>

        <div className="mt-6 grid grid-cols-3 gap-2 rounded-2xl bg-white/5 p-1">
          {tabs.map((item) => <button key={item.value} onClick={() => setActiveTab(item.value)} className={`rounded-xl px-3 py-2 text-sm font-bold transition ${tab === item.value ? "bg-white text-[#10051f]" : "text-gray-300 hover:bg-white/10"}`}>{item.label}</button>)}
        </div>

        {tab === "discover" && (
          <section className="mt-6 space-y-3">
            {people.length === 0 ? <GlassPanel className="rounded-3xl p-8 text-center text-gray-400">No people to discover right now.</GlassPanel> : people.map((profile) => (
              <GlassPanel key={profile.id} className="flex items-center gap-4 rounded-2xl p-4">
                <AnonymousAvatar userId={profile.id} online={onlineUserIds.includes(profile.id)} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{anonymousName(profile.id)}</p>
                  <p className="text-xs text-gray-400">Anonymous Whisper user</p>
                </div>
                <button onClick={() => addFriend(profile.id)} disabled={busyId === profile.id} className="rounded-xl bg-cyan-400 px-3 py-2 text-xs font-black text-[#05010F] disabled:opacity-60"><UserPlus size={14} className="mr-1 inline" /> Add Friend</button>
              </GlassPanel>
            ))}
            {hasMorePeople && (
              <button onClick={showMorePeople} disabled={discoverLoading} className="w-full rounded-2xl bg-white/10 px-4 py-3 text-sm font-bold text-white transition hover:bg-white/15 disabled:opacity-60">
                {discoverLoading ? "Loading..." : "Show More People"}
              </button>
            )}
          </section>
        )}

        {tab === "requests" && (
          <section className="mt-6 space-y-6">
            <RequestList title="Requests" empty="No incoming requests." requests={incoming} mode="incoming" busyId={busyId} onAccept={acceptRequest} onDecline={declineRequest} onCancel={cancelRequest} />
            <RequestList title="Sent Requests" empty="No sent requests." requests={outgoing} mode="outgoing" busyId={busyId} onAccept={acceptRequest} onDecline={declineRequest} onCancel={cancelRequest} />
          </section>
        )}

        {tab === "friends" && (
          <section className="mt-6 space-y-3">
            {friends.length === 0 ? <GlassPanel className="rounded-3xl p-8 text-center text-gray-400">No friends yet.</GlassPanel> : friends.map((friend) => <FriendCard key={friend.id} friend={friend} busy={busyId === friend.friend_id} online={onlineUserIds.includes(friend.friend_id)} onChat={() => startChat(friend.friend_id)} />)}
          </section>
        )}
      </div>
      <BottomNavigation />
    </main>
  );
}

function FriendCard({ friend, onChat, busy, online }: { friend: FriendRow; onChat: () => void; busy: boolean; online: boolean }) {
  return (
    <GlassPanel className="flex items-center gap-4 rounded-2xl p-4">
      <AnonymousAvatar userId={friend.friend_id} online={online} />
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold">{anonymousName(friend.friend_id)}</p>
        <p className="text-xs text-gray-400">Friend</p>
      </div>
      <button onClick={onChat} disabled={busy} className="rounded-xl bg-white/10 p-3 transition hover:bg-white/15 disabled:opacity-60" aria-label="Open chat"><MessageCircle size={18} /></button>
    </GlassPanel>
  );
}

function RequestList({ title, empty, requests, mode, busyId, onAccept, onDecline, onCancel }: { title: string; empty: string; requests: FriendRequestRow[]; mode: "incoming" | "outgoing"; busyId: string | null; onAccept: (requestId: string) => void; onDecline: (requestId: string) => void; onCancel: (requestId: string) => void }) {
  return (
    <div>
      <h2 className="mb-3 text-lg font-black">{title}</h2>
      <div className="space-y-3">
        {requests.length === 0 ? <GlassPanel className="rounded-3xl p-6 text-center text-sm text-gray-400">{empty}</GlassPanel> : requests.map((request) => {
          const profileId = mode === "incoming" ? request.sender_id : request.receiver_id;
          return (
            <GlassPanel key={request.id} className="flex items-center gap-3 rounded-2xl p-4">
              <AnonymousAvatar userId={profileId} online={onlineUserIds.includes(profileId)} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{anonymousName(profileId)}</p>
                <p className="truncate text-xs text-gray-400">{mode === "incoming" ? "Wants to be friends" : "Request pending"}</p>
              </div>
              {mode === "incoming" ? (
                <div className="flex gap-2">
                  <button onClick={() => onAccept(request.id)} disabled={busyId === request.id} className="rounded-xl bg-green-400 px-3 py-2 text-xs font-black text-[#05010F] disabled:opacity-60" aria-label="Accept"><Check size={14} className="mr-1 inline" />Accept</button>
                  <button onClick={() => onDecline(request.id)} disabled={busyId === request.id} className="rounded-xl bg-rose-500 p-2 text-white disabled:opacity-60" aria-label="Decline"><X size={16} /></button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="flex items-center gap-1 text-xs font-bold text-yellow-300"><Clock size={14} />Pending</span>
                  <button onClick={() => onCancel(request.id)} disabled={busyId === request.id} className="rounded-xl bg-white/10 px-3 py-2 text-xs font-bold text-white disabled:opacity-60">Cancel</button>
                </div>
              )}
            </GlassPanel>
          );
        })}
      </div>
    </div>
  );
}

export default function FriendsPage() {
  return (
    <Suspense fallback={<main className="flex min-h-screen items-center justify-center theme-bg-gradient text-white">Loading...</main>}>
      <FriendsPageContent />
    </Suspense>
  );
}