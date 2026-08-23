"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { WifiOff } from "lucide-react";
import { subscribeToConnectivity, isOnline } from "@/lib/offline";

/**
 * The offline indicator.
 *
 * WHAT THIS USED TO DO, AND WHY IT HAD TO STOP
 *
 * It installed a capturing listener on `document` that called `preventDefault()`
 * and `stopPropagation()` on *every* click while offline, then opened a modal
 * saying "Please connect to the internet to continue using Whisper." Which it
 * meant literally: with no connection the entire app was inert — not a single
 * navigation, no scrolling to something already on screen, no reading a
 * conversation the device had already downloaded.
 *
 * That is the opposite of what the cache exists for. Now that the service worker
 * actually installs for everyone and holds the shell plus the last synced data,
 * offline is a *state the app works in*, so this is reduced to what it should
 * always have been: a small honest label saying what you are looking at.
 *
 * Refusing an individual action is a separate job, and belongs to the action.
 * `requireOnline()` in lib/offline.ts does it at the point of the write, which is
 * where the message can be specific about what failed — rather than here, where
 * every tap looks identical and the only available message is a shrug.
 *
 * WHY THE COPY MENTIONS SYNCING
 *
 * The lists on screen may be minutes or hours old. Saying so is the difference
 * between an app that feels reliable and one that appears to be showing live data
 * and quietly is not.
 */
export default function OfflineHandler() {
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    /* Read once on mount as well as subscribing: the subscription only fires on
       transitions, so a page opened while already offline would otherwise show
       nothing until connectivity changed. */
    setOffline(!isOnline());
    return subscribeToConnectivity((online) => setOffline(!online));
  }, []);

  return (
    <AnimatePresence>
      {offline && (
        <motion.div
          role="status"
          aria-live="polite"
          className="offline-pill"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 8 }}
          transition={{ type: "spring", stiffness: 420, damping: 34 }}
        >
          <WifiOff size={12} aria-hidden />
          Offline — showing your last synced copy
        </motion.div>
      )}
    </AnimatePresence>
  );
}
