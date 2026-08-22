 "use client";

import { useEffect, useState } from "react";
import { Network } from "@capacitor/network";
import { WifiOff, X } from "lucide-react";
import GlassPanel from "./GlassPanel";
import Button from "./Button";

export default function OfflineHandler() {
  const [isOffline, setIsOffline] = useState(false);
  const [showPopup, setShowPopup] = useState(false);

  useEffect(() => {
    let listener: Awaited<ReturnType<typeof Network.addListener>> | null = null;

    async function setup() {
      const status = await Network.getStatus();
      setIsOffline(!status.connected);

      listener = await Network.addListener("networkStatusChange", (status) => {
        setIsOffline(!status.connected);
        if (status.connected) {
          setShowPopup(false);
        }
      });
    }

    setup();

    return () => {
      listener?.remove();
    };
  }, []);

  useEffect(() => {
    if (!isOffline) return;

    function handleDocumentClick(e: MouseEvent) {
      if (isOffline) {
        setShowPopup(true);
        e.stopPropagation();
        e.preventDefault();
      }
    }

    document.addEventListener("click", handleDocumentClick, true);
    return () => document.removeEventListener("click", handleDocumentClick, true);
  }, [isOffline]);

  if (!isOffline) return null;

  return (
    <>
      {/* Subtle Offline Indicator */}
      <div className="fixed bottom-24 left-1/2 z-[1000] -translate-x-1/2 rounded-full bg-red-500/20 px-4 py-1.5 text-[10px] font-bold uppercase tracking-widest text-red-200 backdrop-blur-md animate-pulse border border-red-500/30">
        <div className="flex items-center gap-2">
          <WifiOff size={12} />
          Offline Mode
        </div>
      </div>

      {/* The "Please Connect" Popup */}
      {showPopup && (
        <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/60 backdrop-blur-md p-6">
          <GlassPanel strong className="relative w-full max-w-sm rounded-3xl p-8 text-center border border-white/10 shadow-2xl">
            <button
              onClick={() => setShowPopup(false)}
              /* Bridged colour plus an opacity fade, not `text-white/40
                 hover:text-white`. Tailwind's opacity modifier and its variant
                 prefixes each compile to their own class (`.text-white\/40`,
                 `.hover\:text-white:hover`), and the theme bridge in globals.css
                 only rewrites the bare `.text-white` — so both the resting and
                 the hover state were literally white, which is an invisible X on
                 this `GlassPanel`'s light-theme surface. On the one dialog that
                 blocks the whole app. Opacity is theme-independent, so it gives
                 the same two states in both themes. */
              className="absolute top-4 right-4 text-white opacity-50 transition-opacity hover:opacity-100"
            >
              <X size={20} />
            </button>

            <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-purple-600/10 text-purple-500">
              <WifiOff size={40} />
            </div>

            <h2 className="page-title text-white">Connection Lost</h2>
            <p className="mt-3 text-gray-400">
              Please connect to the internet to continue using Whisper.
            </p>

            <Button
              className="mt-8"
              size="lg"
              fullWidth
              onClick={async () => {
                const status = await Network.getStatus();
                if (status.connected) {
                  setIsOffline(false);
                  setShowPopup(false);
                }
              }}
            >
              Retry Connection
            </Button>
          </GlassPanel>
        </div>
      )}
    </>
  );
}