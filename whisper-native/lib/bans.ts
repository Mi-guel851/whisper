import { useCallback, useEffect, useRef, useState } from "react";

import { supabase } from "./supabase";

/**
 * Ban status — the native port of the web app's `lib/bans.ts`.
 *
 * One RPC (`my_ban_status`, migration 202609080001) answers whether the
 * signed-in account is banned, why, and until when. A database without the
 * migration has no function — treated as "not banned" rather than an error,
 * because the alternative blocks every signed-in user on a missing migration
 * (and the triggers, the real gate, would be missing too). The status
 * re-checks every 60 seconds while it has a subscriber.
 */

export type BanStatus = {
  banned: boolean;
  reason: string | null;
  duration: "permanent" | "temporary" | null;
  expiresAt: string | null;
  createdAt: string | null;
};

const NOT_BANNED: BanStatus = {
  banned: false,
  reason: null,
  duration: null,
  expiresAt: null,
  createdAt: null,
};

const RECHECK_MS = 60_000;

export function useBanStatus(): BanStatus & { checking: boolean; recheck: () => void } {
  const [status, setStatus] = useState<BanStatus>(NOT_BANNED);
  const [checking, setChecking] = useState(true);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!alive.current) return;
    if (!session) {
      setStatus(NOT_BANNED);
      setChecking(false);
      return;
    }

    const { data, error } = await supabase.rpc("my_ban_status");
    if (!alive.current) return;

    if (error) {
      setStatus(NOT_BANNED);
      setChecking(false);
      return;
    }

    const row = (Array.isArray(data) ? data[0] : data) as
      | { banned?: boolean; reason?: string | null; duration?: "permanent" | "temporary" | null; expires_at?: string | null; created_at?: string | null }
      | null;

    if (!row || row.banned !== true) {
      setStatus(NOT_BANNED);
      setChecking(false);
      return;
    }

    setStatus({
      banned: true,
      reason: row.reason ?? null,
      duration: row.duration ?? null,
      expiresAt: row.expires_at ?? null,
      createdAt: row.created_at ?? null,
    });
    setChecking(false);
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), RECHECK_MS);
    return () => {
      clearInterval(timer);
    };
  }, [load]);

  const recheck = useCallback(() => void load(), [load]);

  return { ...status, checking, recheck };
}

/** "May 4, 2026 at 3:00 PM" — the web's formatBanExpiry, same shape. */
export function formatBanExpiry(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
