"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Radar } from "lucide-react";

import { supabase } from "@/lib/supabase/client";
import { useToast } from "@/components/ToastProvider";
import useSafeReducedMotion from "@/lib/useSafeReducedMotion";
import { spring, tween } from "@/lib/motion";

/**
 * The "Appear in Find a Match" switch.
 *
 * DEFAULT ON, on purpose: Find a Match is a discoverability surface, and a
 * feature that is off by default discovers nobody. The honest counterweight is
 * the documentation right here in the sub-label — the radar only ever sees
 * the self-declared COUNTRY (Complete Profile input), never a precise
 * location — plus the switch itself, which is one tap and saved server-side.
 *
 * The row is its own component (rather than inlined in Settings) for the same
 * reason HapticsSettingRow is: it has its own load + optimistic-write lifecycle,
 * and Settings is a static list of links that should stay static.
 *
 * `find_a_match_enabled !== false` — a NULL column (a database that has not
 * received 202609090003 yet) must read as ON, the default, not as an error.
 */
export default function FindAMatchSettingRow() {
  const reduced = useSafeReducedMotion();
  const { showToast } = useToast();

  /* Starts at the documented default. The real value lands from the profile
     row; until it does, the switch is not interactive, so the default can
     never be mistaken for the saved preference. */
  const [enabled, setEnabled] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const userId = session?.user.id;
      if (!userId || cancelled) return;
      const { data: row } = await supabase
        .from("profiles")
        .select("find_a_match_enabled")
        .eq("id", userId)
        .maybeSingle();
      if (cancelled) return;
      if (row) setEnabled(row.find_a_match_enabled !== false);
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function toggle() {
    if (!loaded || saving) return;
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const userId = session?.user.id;
    if (!userId) return;

    const next = !enabled;
    setEnabled(next);
    setSaving(true);
    const { error } = await supabase
      .from("profiles")
      .update({ find_a_match_enabled: next })
      .eq("id", userId);
    setSaving(false);
    if (error) {
      /* Roll the knob back: a switch that claims ON while the server says
         OFF is exactly the "setting I can't trust" bug this app keeps fixing. */
      setEnabled(!next);
      showToast("Couldn't save that setting. Please try again.");
    }
  }

  return (
    <div className="py-3.5 px-1">
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/5 text-purple-300">
            <Radar size={17} />
          </span>
          <span className="min-w-0">
            {/* Bare `text-white`, not `text-white/90` — the theme bridge only
                rewrites the bare class, so `/N` variants vanish on light
                (same rule as HapticsSettingRow). */}
            <span className="block text-sm font-medium text-white">Appear in Find a Match</span>
            <span className="block text-[11px] theme-text-subtle">
              Let the radar find you — by your chosen country only, never a location
            </span>
          </span>
        </span>

        <button
          type="button"
          role="switch"
          aria-checked={enabled && loaded}
          aria-label="Appear in Find a Match"
          onClick={toggle}
          disabled={!loaded || saving}
          /* Same no-press / zero-padding discipline as the haptics switch:
             the knob travels, the track must not buckle. */
          className={`no-press relative box-border h-6 w-11 shrink-0 rounded-full border-0 p-0 transition-colors disabled:opacity-50 ${
            enabled && loaded ? "bg-purple-500" : "bg-white/15"
          }`}
        >
          <motion.span
            className="absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow"
            animate={{ x: enabled && loaded ? 20 : 0 }}
            transition={reduced ? { duration: 0 } : spring.snappy}
          />
        </button>
      </div>

      {saving && (
        <motion.p
          initial={reduced ? { opacity: 0 } : { opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={tween.base}
          className="mt-2 text-[11px] theme-text-subtle"
        >
          Saving…
        </motion.p>
      )}
    </div>
  );
}
