"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Check, UserPlus, Users } from "lucide-react";

import { useToast } from "@/components/ToastProvider";
import { useAnonNames } from "@/lib/anonNames";
import { generatedAvatarUrl } from "@/lib/generatedAvatar";
import { requireOnline } from "@/lib/offline";
import { supabase } from "@/lib/supabase/client";

type Candidate = {
  profile_id: string;
  country_code: string | null;
  active_recent: boolean;
};

function validCandidates(value: unknown): Candidate[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (row): row is Candidate =>
      Boolean(row) &&
      typeof row === "object" &&
      typeof (row as Candidate).profile_id === "string"
  );
}

export default function DiscoverPeopleCard({ myId }: { myId: string }) {
  const { showToast } = useToast();
  const [people, setPeople] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [requested, setRequested] = useState<Set<string>>(new Set());
  const ids = useMemo(() => people.map((person) => person.profile_id), [people]);
  const nameOf = useAnonNames(ids);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const { data, error } = await supabase.rpc("find_match_candidates", { p_page: 0 });
      if (cancelled) return;
      if (error) {
        console.warn("Dashboard people discovery unavailable:", error.message);
        setLoading(false);
        return;
      }
      setPeople(validCandidates(data).filter((candidate) => candidate.profile_id !== myId).slice(0, 4));
      setLoading(false);
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [myId]);

  async function addFriend(personId: string) {
    if (!requireOnline(showToast, "Sending a friend request")) return;
    if (!myId || myId === personId) return;

    setBusy(personId);
    const { data: existing, error: existingError } = await supabase
      .from("friend_requests")
      .select("id")
      .or(`and(sender_id.eq.${myId},receiver_id.eq.${personId}),and(sender_id.eq.${personId},receiver_id.eq.${myId})`)
      .eq("status", "pending")
      .maybeSingle();

    if (existingError) {
      console.warn("Friend request check failed:", existingError.message);
      showToast("We couldn't check that connection. Please try again.");
      setBusy(null);
      return;
    }
    if (existing) {
      setRequested((current) => new Set(current).add(personId));
      showToast("A friend request already exists between you two.", { variant: "subtle" });
      setBusy(null);
      return;
    }

    const { error } = await supabase
      .from("friend_requests")
      .insert({ sender_id: myId, receiver_id: personId, status: "pending" });

    if (error && error.code !== "23505") {
      console.warn("Friend request failed:", error.message);
      showToast("Friend request failed. Please try again.");
    } else {
      setRequested((current) => new Set(current).add(personId));
      showToast("Friend request sent.", { variant: "success" });
    }
    setBusy(null);
  }

  return (
    <section className="dashboard-rail-card dashboard-people-card" aria-labelledby="discover-people-title">
      <div className="dashboard-rail-heading">
        <div><span className="dashboard-rail-icon"><Users size={15} /></span><h2 id="discover-people-title">Discover people</h2></div>
        <Link href="/friends?tab=discover" aria-label="Open people discovery"><ArrowRight size={14} /></Link>
      </div>

      <div className="dashboard-people-list" aria-busy={loading}>
        {loading ? (
          Array.from({ length: 3 }).map((_, index) => <div className="dashboard-person-skeleton" key={index}><i /><span /><b /></div>)
        ) : people.length === 0 ? (
          <div className="dashboard-people-empty">
            <p>Run a private match scan to find new people.</p>
            <Link href="/friends">Find a match</Link>
          </div>
        ) : (
          people.slice(0, 3).map((person) => {
            const sent = requested.has(person.profile_id);
            return (
              <div className="dashboard-person-row" key={person.profile_id}>
                <span className="dashboard-person-avatar">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={generatedAvatarUrl(person.profile_id)} alt="" />
                  {person.active_recent && <i aria-label="Recently active" />}
                </span>
                <span className="min-w-0 flex-1">
                  <strong className="block truncate">{nameOf(person.profile_id)}</strong>
                  <small>{person.active_recent ? "Recently active" : "Suggested for you"}</small>
                </span>
                <button
                  type="button"
                  onClick={() => addFriend(person.profile_id)}
                  disabled={busy === person.profile_id || sent}
                  aria-label={sent ? `Friend request sent to ${nameOf(person.profile_id)}` : `Add ${nameOf(person.profile_id)} as a friend`}
                >
                  {sent ? <Check size={15} /> : <UserPlus size={15} />}
                </button>
              </div>
            );
          })
        )}
      </div>

      <Link href="/friends?tab=friends" className="dashboard-people-footer">View friends and requests <ArrowRight size={13} /></Link>
    </section>
  );
}
