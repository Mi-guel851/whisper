"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { getDeterministicAnonLabel } from "@/lib/anonIdentity";
import { presenceManager } from "@/lib/realtime/presence";
import BackButton from "@/components/BackButton";
import BottomNavigation from "@/components/BottomNavigation";
import GlassPanel from "@/components/GlassPanel";
import { Users, MessageCircle } from "lucide-react";

type OnlinePerson = {
  userId: string;
  label: string;
};

export default function ActiveUsersPage() {
  const router = useRouter();

  const [myId, setMyId] = useState("");
  const [onlineUsers, setOnlineUsers] = useState<OnlinePerson[]>([]);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState<string | null>(null);

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;

    async function init() {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        setLoading(false);
        return;
      }

      setMyId(session.user.id);

      await presenceManager.connect(session.user.id);

      unsubscribe = presenceManager.subscribe((users) => {
        setOnlineUsers(
          users
            .filter((u) => u.id !== session.user.id)
            .map((u) => ({
              userId: u.id,
              label: getDeterministicAnonLabel(u.id),
            }))
        );

        setLoading(false);
      });
    }

    init();

    return () => {
      unsubscribe?.();
    };
  }, []);

  async function startChat(otherUserId: string) {
    setConnecting(otherUserId);

    const [userA, userB] = [myId, otherUserId].sort();

    const { data: existing } = await supabase
      .from("conversations")
      .select("id")
      .eq("user_a", userA)
      .eq("user_b", userB)
      .maybeSingle();

    if (existing) {
      router.push(`/chat/${existing.id}`);
      return;
    }

    const { data: created, error } = await supabase
  .from("conversations")
  .insert({
    user_a: userA,
    user_b: userB,
    user_a_label: getDeterministicAnonLabel(userB),
    user_b_label: getDeterministicAnonLabel(userA),
  })
  .select("id")
  .single();
    setConnecting(null);

    if (error || !created) {
      console.error(error);
      return;
    }

    router.push(`/chat/${created.id}`);
  }

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-[#090014] text-white">
        Loading...
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-[#090014] via-[#170033] to-[#02000A] text-white pb-28">
      <div className="p-6">
        <BackButton />

        <div className="mt-4 flex items-center gap-3">
          <Users className="text-cyan-300" size={28} />
          <h1 className="text-3xl font-black">
            Active Now
          </h1>
        </div>

        <p className="mt-2 text-gray-400">
          {onlineUsers.length} people online
        </p>

        <div className="mt-8 space-y-3">
          {onlineUsers.length === 0 ? (
            <GlassPanel className="rounded-3xl p-8 text-center">
              Nobody else is online.
            </GlassPanel>
          ) : (
            onlineUsers.map((person) => (
              <button
                key={person.userId}
                onClick={() => startChat(person.userId)}
                disabled={connecting === person.userId}
                className="w-full text-left"
              >
                <GlassPanel className="flex items-center gap-4 rounded-2xl p-4 hover:bg-white/5 transition">
                  <div className="relative flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-cyan-500 to-purple-600">
                    👻
                    <span className="absolute bottom-0 right-0 h-3 w-3 rounded-full bg-green-400 border-2 border-[#090014]" />
                  </div>

                  <div className="flex-1">
                    <p className="font-semibold">
                      {person.label}
                    </p>

                    <p className="text-xs text-green-400">
                      Online
                    </p>
                  </div>

                  <MessageCircle size={20} />
                </GlassPanel>
              </button>
            ))
          )}
        </div>
      </div>

      <BottomNavigation />
    </main>
  );
}