"use client";

import { useEffect } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";

/**
 * /call/[conversationId] — Answer / Decline entry point for FCM action buttons.
 *
 * FCM delivers Answer → whisperapp://call/{id}?answer=true&callId=...&callerName=...
 * AppUrlHandler rewrites whisperapp://call/* → /chat/*?answer=..., but a user
 * who taps the system notification's action while the app is killed may land
 * here via an https:// deep link or via the JS fallback that uses window.location.
 * This route exists so /call/{id}?answer=true is a real address, not a 404,
 * and it forwards instantly (no animation) to the chat thread that owns the
 * call — where CallSessionProvider will auto-accept if ?answer=true is present
 * and the call is still ringing.
 *
 * The skeleton renders for a single frame so the full-screen intent never
 * lands on a blank page while the router swaps. No data is fetched here;
 * the chat page and the call engine own everything.
 */
export default function CallRedirectPage() {
  const params = useParams<{ conversationId: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const id = params.conversationId;
    if (!id) {
      router.replace("/dashboard");
      return;
    }
    const qs = searchParams.toString();
    // Instant forward — preserve answer/callId/callerName/avatar for the chat
    // screen's skeleton + provider's prefetch.
    router.replace(`/chat/${encodeURIComponent(id)}${qs ? `?${qs}` : ""}`);
  }, [params, router, searchParams]);

  return (
    <main className="call-surface fixed inset-0 z-[60] flex flex-col items-center justify-center bg-[#07130f] px-6 text-white">
      <div
        className="absolute inset-0 opacity-90"
        style={{
          background:
            "radial-gradient(circle at 50% 22%, rgba(37,211,102,0.30), transparent 30%), radial-gradient(circle at 15% 85%, rgba(34,211,238,0.16), transparent 32%), linear-gradient(180deg, #0b2119 0%, #06100d 62%, #020605 100%)",
        }}
      />
      <div className="relative z-10 flex flex-col items-center">
        <div className="h-28 w-28 animate-pulse rounded-full bg-white/10" style={{ border: "4px solid rgba(37,211,102,0.22)" }} aria-hidden />
        <div className="mt-6 h-6 w-36 animate-pulse rounded-full bg-white/12" aria-hidden />
        <div className="mt-3 h-4 w-24 animate-pulse rounded-full bg-white/10" aria-hidden />
        <p className="mt-8 text-xs font-semibold tracking-widest text-white/60">CONNECTING…</p>
      </div>
    </main>
  );
}
