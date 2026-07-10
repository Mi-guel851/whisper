"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Check, Clock, MessageCircle, Search, UserPlus, Users, X } from "lucide-react";

import { supabase } from "@/lib/supabase/client";
import { presenceManager } from "@/lib/realtime/presence";
import BackButton from "@/components/BackButton";
import BottomNavigation from "@/components/BottomNavigation";
import GlassPanel from "@/components/GlassPanel";

type FriendTab = "friends" | "requests" | "active";
type RequestStatus = "pending" | "accepted" | "rejected" | "cancelled";

type ProfileSummary = {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
};

type SearchResult = ProfileSummary & {
  relationship: "none" | "friends" | "pending";
};

type RawFriendRow = Omit<FriendRow, "friend"> & { friend: ProfileSummary | ProfileSummary[] | null };

type RawFriendRequestRow = Omit<FriendRequestRow, "requester" | "receiver"> & {
  requester: FriendRequestProfile | FriendRequestProfile[] | null;
  receiver: FriendRequestProfile | FriendRequestProfile[] | null;
};

type FriendRow = {
  id: string;
  user_id: string;
  friend_id: string;
  created_at: string;
  friend: ProfileSummary | null;
};

type FriendRequestProfile = ProfileSummary;

type FriendRequestRow = {
  id: string;
  requester_id: string;
  receiver_id: string;
  status: RequestStatus;
  created_at: string;
  updated_at: string;
  requester: FriendRequestProfile | null;
  receiver: FriendRequestProfile | null;
};

type OnlineFriend = FriendRow & {
  isOnline: boolean;
};

const tabs: { value: FriendTab; label: string }[] = [
  { value: "friends", label: "Friends" },
  { value: "requests", label: "Requests" },
  { value: "active", label: "Active" },
];

function uniqueChannelName(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function normalizeTab(value: string | null): FriendTab {
  return value === "requests" || value === "active" ? value : "friends";
}


function singleProfile<T extends ProfileSummary>(profile: T | T[] | null): T | null {
  return Array.isArray(profile) ? profile[0] ?? null : profile;
}

function normalizeFriendRows(rows: RawFriendRow[]): FriendRow[] {
  return rows.map((row) => ({ ...row, friend: singleProfile(row.friend) }));
}

function normalizeRequestRows(rows: RawFriendRequestRow[]): FriendRequestRow[] {
  return rows.map((row) => ({
    ...row,
    requester: singleProfile(row.requester),
    receiver: singleProfile(row.receiver),
  }));
}

function initials(profile: ProfileSummary | null) {
  return (profile?.display_name || profile?.username || "?").slice(0, 1).toUpperCase();
}

function Avatar({ profile, online }: { profile: ProfileSummary | null; online?: boolean }) {
  return (
    <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-full bg-gradient-to-br from-cyan-500 to-purple-600">
      {profile?.avatar_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={profile.avatar_url} alt={profile.username} className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-lg font-black text-white">
          {initials(profile)}
        </div>
      )}
      {online && <span className="absolute bottom-0 right-0 h-3.5 w-3.5 rounded-full border-2 border-[#05010F] bg-green-400" />}
    </div>
  );
}

function FriendsPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [myId, setMyId] = useState("");
  const [loading, setLoading] = useState(true);
  const [friends, setFriends] = useState<FriendRow[]>([]);
  const [incoming, setIncoming] = useState<FriendRequestRow[]>([]);
  const [outgoing, setOutgoing] = useState<FriendRequestRow[]>([]);
  const [onlineIds, setOnlineIds] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadFriends = useCallback(async (userId: string) => {
    const { data } = await supabase
      .from("friends")
      .select("id,user_id,friend_id,created_at,friend:profiles!friends_friend_id_fkey(id,username,display_name,avatar_url)")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    setFriends(normalizeFriendRows((data || []) as unknown as RawFriendRow[]));
  }, []);

  const loadRequests = useCallback(async (userId: string) => {
    const [incomingRes, outgoingRes] = await Promise.all([
      supabase
        .from("friend_requests")
        .select("id,requester_id,receiver_id,status,created_at,updated_at,requester:profiles!friend_requests_requester_id_fkey(id,username,display_name,avatar_url),receiver:profiles!friend_requests_receiver_id_fkey(id,username,display_name,avatar_url)")
        .eq("receiver_id", userId)
        .order("created_at", { ascending: false }),
      supabase
        .from("friend_requests")
        .select("id,requester_id,receiver_id,status,created_at,updated_at,requester:profiles!friend_requests_requester_id_fkey(id,username,display_name,avatar_url),receiver:profiles!friend_requests_receiver_id_fkey(id,username,display_name,avatar_url)")
        .eq("requester_id", userId)
        .order("created_at", { ascending: false }),
    ]);

    setIncoming(normalizeRequestRows((incomingRes.data || []) as unknown as RawFriendRequestRow[]));
    setOutgoing(normalizeRequestRows((outgoingRes.data || []) as unknown as RawFriendRequestRow[]));
  }, []);

  const refreshAll = useCallback(async (userId: string) => {
    await Promise.all([loadFriends(userId), loadRequests(userId)]);
  }, [loadFriends, loadRequests]);

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

      if (cancelled) return;
      setMyId(session.user.id);
      await presenceManager.connect(session.user.id);
      unsubscribePresence = presenceManager.subscribe((users) => {
        setOnlineIds(new Set(users.map((user) => user.id)));
      });
      await refreshAll(session.user.id);
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
  }, [refreshAll]);

  useEffect(() => {
    if (!myId) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);

    const cleanQuery = query.trim().toLowerCase();
    debounceRef.current = setTimeout(async () => {
      if (cleanQuery.length < 2) {
        setResults([]);
        setSearching(false);
        return;
      }

      setSearching(true);
      const { data } = await supabase
        .from("profiles")
        .select("id,username,display_name,avatar_url")
        .ilike("username", `%${cleanQuery}%`)
        .neq("id", myId)
        .order("username", { ascending: true })
        .limit(10);

      const seen = new Set<string>();
      const rows = ((data || []) as ProfileSummary[]).filter((profile) => {
        if (seen.has(profile.id)) return false;
        seen.add(profile.id);
        return true;
      });

      const friendIds = new Set(friends.map((friend) => friend.friend_id));
      const pendingIds = new Set([
        ...incoming.filter((request) => request.status === "pending").map((request) => request.requester_id),
        ...outgoing.filter((request) => request.status === "pending").map((request) => request.receiver_id),
      ]);

      setResults(rows.map((profile) => ({
        ...profile,
        relationship: friendIds.has(profile.id) ? "friends" : pendingIds.has(profile.id) ? "pending" : "none",
      })));
      setSearching(false);
    }, 300);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [friends, incoming, myId, outgoing, query]);

  const tab = normalizeTab(searchParams.get("tab"));

  const activeFriends = useMemo<OnlineFriend[]>(() => (
    friends.map((friend) => ({ ...friend, isOnline: onlineIds.has(friend.friend_id) })).filter((friend) => friend.isOnline)
  ), [friends, onlineIds]);

  function setActiveTab(nextTab: FriendTab) {
    router.replace(`/friends${nextTab === "friends" ? "" : `?tab=${nextTab}`}`);
  }

  async function addFriend(profileId: string) {
    if (!myId) return;
    setBusyId(profileId);
    const { error } = await supabase.from("friend_requests").insert({ requester_id: myId, receiver_id: profileId });
    if (error) console.error(error.message);
    await refreshAll(myId);
    setBusyId(null);
  }

  async function respond(requestId: string, action: "accepted" | "rejected") {
    if (!myId) return;
    setBusyId(requestId);
    if (action === "accepted") {
      const { error } = await supabase.rpc("accept_friend_request", { request_id: requestId });
      if (error) console.error(error.message);
    } else {
      const { error } = await supabase
        .from("friend_requests")
        .update({ status: "rejected", updated_at: new Date().toISOString() })
        .eq("id", requestId)
        .eq("receiver_id", myId);
      if (error) console.error(error.message);
    }
    await refreshAll(myId);
    setBusyId(null);
  }

  async function startChat(friendId: string) {
    const [userA, userB] = [myId, friendId].sort();
    const { data: conversation } = await supabase
      .from("conversations")
      .select("id")
      .eq("user_a", userA)
      .eq("user_b", userB)
      .maybeSingle();

    if (conversation?.id) router.push(`/chat/${conversation.id}`);
  }

  if (loading) {
    return <main className="flex min-h-screen items-center justify-center theme-bg-gradient text-white">Loading...</main>;
  }

  return (
    <main className="min-h-screen theme-bg-gradient pb-28 text-white">
      <div className="mx-auto max-w-2xl px-6 py-8">
        <BackButton />
        <div className="mt-4 flex items-center gap-3">
          <Users className="text-cyan-300" size={28} />
          <h1 className="text-3xl font-black">Friends</h1>
        </div>
        <p className="mt-2 text-sm text-gray-400">Find friends by username, manage requests, and chat for free once connected.</p>

        <div className="mt-6 grid grid-cols-3 gap-2 rounded-2xl bg-white/5 p-1">
          {tabs.map((item) => (
            <button key={item.value} onClick={() => setActiveTab(item.value)} className={`rounded-xl px-3 py-2 text-sm font-bold transition ${tab === item.value ? "bg-white text-[#10051f]" : "text-gray-300 hover:bg-white/10"}`}>
              {item.label}
            </button>
          ))}
        </div>

        <GlassPanel className="mt-6 rounded-3xl p-4">
          <label className="flex items-center gap-3 rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
            <Search size={18} className="text-cyan-300" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search username" className="w-full bg-transparent text-sm text-white outline-none placeholder:text-gray-500" />
          </label>
          {query.trim().length > 0 && (
            <div className="mt-4 space-y-3">
              {searching ? <p className="text-sm text-gray-400">Searching...</p> : results.length === 0 ? <p className="text-sm text-gray-400">No users found.</p> : results.map((profile) => (
                <div key={profile.id} className="flex items-center gap-3 rounded-2xl bg-white/5 p-3">
                  <Avatar profile={profile} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">@{profile.username}</p>
                    {profile.display_name && <p className="truncate text-xs text-gray-400">{profile.display_name}</p>}
                  </div>
                  {profile.relationship === "friends" ? <span className="flex items-center gap-1 text-sm font-bold text-green-300"><Check size={16} /> Friends</span> : profile.relationship === "pending" ? <span className="text-sm font-bold text-yellow-300">Pending</span> : <button onClick={() => addFriend(profile.id)} disabled={busyId === profile.id} className="rounded-xl bg-cyan-400 px-3 py-2 text-xs font-black text-[#05010F] disabled:opacity-60"><UserPlus size={14} className="mr-1 inline" /> Add</button>}
                </div>
              ))}
            </div>
          )}
        </GlassPanel>

        {tab === "friends" && <section className="mt-6 space-y-3">{friends.length === 0 ? <GlassPanel className="rounded-3xl p-8 text-center text-gray-400">No friends yet. Search by username to add someone.</GlassPanel> : friends.map((friend) => <FriendCard key={friend.id} friend={friend} online={onlineIds.has(friend.friend_id)} onChat={() => startChat(friend.friend_id)} />)}</section>}

        {tab === "active" && <section className="mt-6 space-y-3">{activeFriends.length === 0 ? <GlassPanel className="rounded-3xl p-8 text-center text-gray-400">No friends are online right now.</GlassPanel> : activeFriends.map((friend) => <FriendCard key={friend.id} friend={friend} online onChat={() => startChat(friend.friend_id)} />)}</section>}

        {tab === "requests" && <section className="mt-6 space-y-6"><RequestList title="Incoming Requests" empty="No incoming requests." requests={incoming} mode="incoming" busyId={busyId} onRespond={respond} /><RequestList title="Outgoing Requests" empty="No outgoing requests." requests={outgoing} mode="outgoing" busyId={busyId} onRespond={respond} /></section>}
      </div>
      <BottomNavigation />
    </main>
  );
}

function FriendCard({ friend, online, onChat }: { friend: FriendRow; online: boolean; onChat: () => void }) {
  return (
    <GlassPanel className="flex items-center gap-4 rounded-2xl p-4">
      <Avatar profile={friend.friend} online={online} />
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold">@{friend.friend?.username || "friend"}</p>
        <p className={`text-xs ${online ? "text-green-400" : "text-gray-400"}`}>{online ? "Online" : "Offline · last seen unavailable"}</p>
      </div>
      <button onClick={onChat} className="rounded-xl bg-white/10 p-3 transition hover:bg-white/15" aria-label="Open chat"><MessageCircle size={18} /></button>
    </GlassPanel>
  );
}

function RequestList({ title, empty, requests, mode, busyId, onRespond }: { title: string; empty: string; requests: FriendRequestRow[]; mode: "incoming" | "outgoing"; busyId: string | null; onRespond: (requestId: string, action: "accepted" | "rejected") => void }) {
  return (
    <div>
      <h2 className="mb-3 text-lg font-black">{title}</h2>
      <div className="space-y-3">
        {requests.length === 0 ? <GlassPanel className="rounded-3xl p-6 text-center text-sm text-gray-400">{empty}</GlassPanel> : requests.map((request) => {
          const profile = mode === "incoming" ? request.requester : request.receiver;
          return (
            <GlassPanel key={request.id} className="flex items-center gap-3 rounded-2xl p-4">
              <Avatar profile={profile} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">@{profile?.username || "user"}</p>
                {profile?.display_name && <p className="truncate text-xs text-gray-400">{profile.display_name}</p>}
              </div>
              {mode === "incoming" && request.status === "pending" ? <div className="flex gap-2"><button onClick={() => onRespond(request.id, "accepted")} disabled={busyId === request.id} className="rounded-xl bg-green-400 p-2 text-[#05010F] disabled:opacity-60"><Check size={16} /></button><button onClick={() => onRespond(request.id, "rejected")} disabled={busyId === request.id} className="rounded-xl bg-rose-500 p-2 text-white disabled:opacity-60"><X size={16} /></button></div> : <span className="flex items-center gap-1 text-xs font-bold capitalize text-yellow-300"><Clock size={14} />{request.status}</span>}
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
