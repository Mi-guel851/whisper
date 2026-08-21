"use client";

import { memo, useMemo } from "react";
import { useAnonNames } from "@/lib/anonNames";
import { generatedAvatarUrl } from "@/lib/generatedAvatar";

type FriendHeaderProps = {
  friendIds: string[];
  onlineUserIds: string[];
  onSelect?: (friendId: string) => void | Promise<void>;
};

function FriendsHeader({ friendIds, onlineUserIds, onSelect }: FriendHeaderProps) {
  const nameOf = useAnonNames(friendIds);
  const onlineIds = useMemo(() => new Set(onlineUserIds), [onlineUserIds]);
  const friends = useMemo(
    () => [...new Set(friendIds)]
      .map((id, index) => ({ id, index, avatarUrl: generatedAvatarUrl(id) }))
      .sort((a, b) => Number(onlineIds.has(b.id)) - Number(onlineIds.has(a.id)) || a.index - b.index),
    [friendIds, onlineIds]
  );

  return (
    <section className="friends-strip sticky top-0 z-20 -mx-6 mb-8 rounded-3xl border px-5 pb-3 pt-3" aria-labelledby="friends-heading">
      <div className="mb-2 flex items-center justify-between px-1">
        <h2 id="friends-heading" className="text-lg font-bold">Friends</h2>
        {friends.length > 0 && <span className="text-xs opacity-70">{friends.length} friends</span>}
      </div>

      {friends.length === 0 ? (
        <div className="rounded-3xl border border-white/10 bg-white/[0.04] px-5 py-4 text-sm text-gray-400 shadow-lg shadow-black/10 backdrop-blur-xl">
          No friends yet
        </div>
      ) : (
        <div className="overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <div className="flex min-w-max gap-4">
            {friends.map(({ id, avatarUrl }) => {
              const isOnline = onlineIds.has(id);
              const content = (
                <>
                  <div className="relative mx-auto w-fit transition duration-200 group-hover:-translate-y-1 group-active:scale-95">
                    <img
                      src={avatarUrl}
                      alt=""
                      className="h-14 w-14 rounded-full border border-white/25 bg-white/10 object-cover p-0.5 shadow-lg shadow-indigo-950/20"
                      loading="lazy"
                    />
                    <span
                        className={`absolute bottom-0.5 right-0.5 h-4 w-4 rounded-full border-[3px] border-[var(--theme-card)] ${
                        isOnline ? "bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.8)]" : "bg-gray-600"
                      }`}
                      aria-label={isOnline ? "Online" : "Offline"}
                    />
                  </div>
                  <span
                    className="friends-name mt-2 block max-w-20 truncate text-center text-xs"
                    style={{ color: "#ffffff", fontWeight: 800 }}
                  >
                    {nameOf(id)}
                  </span>
                </>
              );

              return onSelect ? (
                <button
                  key={id}
                  type="button"
                  onClick={() => onSelect(id)}
                  className="group w-20 shrink-0 rounded-2xl px-1 py-2 transition hover:bg-white/[0.07] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 active:bg-white/[0.1]"
                  aria-label={`Open chat with ${nameOf(id)}`}
                >
                  {content}
                </button>
              ) : (
                <div key={id} className="group w-20 shrink-0 rounded-2xl px-1 py-2">
                  {content}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}

export default memo(FriendsHeader);
