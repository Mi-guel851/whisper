"use client";

import { useEffect, useState } from "react";
import { Network } from "@capacitor/network";
import { WifiOff, X } from "lucide-react";
import GlassPanel from "./GlassPanel";

export default function OfflineHandler() {
  const [isOffline, setIsOffline] = useState(false);
  const [showPopup, setShowPopup] = useState(false);

  useEffect(() => {
    async function checkNetwork() {
      const status = await Network.getStatus();
      setIsOffline(!status.connected);
    }

    checkNetwork();

    const listenerPromise = Network.addListener("networkStatusChange", (status) => {
      setIsOffline(!status.connected);
      if (status.connected) {
        setShowPopup(false);
      }
    });

    return () => {
      void listenerPromise.then((listener) => listener.remove());
    };
  }, []);

  useEffect(() => {
    if (!isOffline) return;

    // Handle any click on the document while offline
    function handleDocumentClick(e: MouseEvent) {
      if (isOffline) {
        setShowPopup(true);
        // Prevent interaction with the rest of the app
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
      {/* Subtle Offline Indicator (The "Static Page" Vibe) */}
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
              className="absolute top-4 right-4 text-white/40 hover:text-white"
            >
              <X size={20} />
            </button>

            <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-cyan-500/10 text-cyan-400">
              <WifiOff size={40} />
            </div>

            <h2 className="text-2xl font-black text-white">Connection Lost</h2>
            <p className="mt-3 text-gray-400">
              Please connect to the internet to continue using Whisper.
            </p>

            <button
              onClick={async () => {
                const status = await Network.getStatus();
                if (status.connected) {
                   setIsOffline(false);
                   setShowPopup(false);
                } else {
                   // Vibrate or show slight shake if still offline
                }
              }}
              className="mt-8 w-full rounded-2xl bg-gradient-to-r from-cyan-400 to-purple-500 p-4 font-bold text-black shadow-lg shadow-cyan-500/20 active:scale-95 transition"
            >
              Retry Connection
            </button>
          </GlassPanel>
        </div>
      )}
    </>
  );
}