"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import {
  BarChart3,
  Coins,
  Flag,
  Image as ImageIcon,
  LayoutDashboard,
  LogOut,
  Megaphone,
  MessageSquare,
  ShieldCheck,
  ShieldAlert,
  Terminal,
  Users,
  X,
} from "lucide-react";

import { supabase } from "@/lib/supabase/client";
import { getCachedSession } from "@/lib/supabase/session";
import { isAdminEmail } from "@/lib/admin/emails";
import {
  AdminRequestError,
  adminFetch,
  clearStoredPin,
  getStoredPin,
  setStoredPin,
} from "@/lib/admin/client";
import { AdminButton, AdminErrorState, adminInputClass } from "@/components/admin/primitives";
import BrandedLoader from "@/components/BrandedLoader";

/**
 * The shell every admin section renders inside.
 *
 * It owns three things the individual pages should not have to:
 *
 *   1. AUTH. Signed out → /login. No session, no panel.
 *   2. THE PIN GATE. Nothing inside `children` mounts until the PIN has been
 *      accepted by the server, so a page can assume its requests are authorized
 *      and does not need its own unlock state.
 *   3. NAVIGATION, including the mobile drawer.
 *
 * WHAT THE GATE DOES NOT DO
 *
 * Passing it changes React state and stores the PIN in sessionStorage. Neither is
 * a security boundary and this component is not where the panel is secured — every
 * route re-verifies the PIN per request (lib/admin/auth.ts), and every admin RPC
 * is unreachable from a browser at all. The gate exists so the unlock failure is
 * reported on the screen where the PIN was typed.
 *
 * It is a client component because the session lives in localStorage
 * (lib/supabase/client.ts uses the default browser storage), so there is no
 * server-side session to check and no reason to pretend there is one.
 */

type Section = {
  href: string;
  label: string;
  icon: typeof Users;
  /** Matched as a prefix, so /admin/users/123 keeps Users highlighted. */
  match: string;
};

const SECTIONS: Section[] = [
  { href: "/admin", label: "Overview", icon: LayoutDashboard, match: "/admin" },
  { href: "/admin/users", label: "Users", icon: Users, match: "/admin/users" },
  { href: "/admin/messages", label: "Messages", icon: MessageSquare, match: "/admin/messages" },
  { href: "/admin/media", label: "Media", icon: ImageIcon, match: "/admin/media" },
  { href: "/admin/moderation", label: "Moderation", icon: ShieldAlert, match: "/admin/moderation" },
  { href: "/admin/coins", label: "Coins", icon: Coins, match: "/admin/coins" },
  { href: "/admin/announcements", label: "Announcements", icon: Megaphone, match: "/admin/announcements" },
  { href: "/admin/reports", label: "Reports", icon: Flag, match: "/admin/reports" },
  { href: "/admin/system", label: "System", icon: Terminal, match: "/admin/system" },
];

/** Exact-match sections, so `/admin` doesn't highlight on every page. */
function isActive(pathname: string, section: Section): boolean {
  if (section.href === "/admin") return pathname === "/admin";
  return pathname === section.href || pathname.startsWith(`${section.match}/`);
}

export default function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  const [phase, setPhase] = useState<"checking" | "unlock" | "denied" | "ready" | "error">("checking");
  const [pin, setPin] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<{ message: string; misconfigured: boolean } | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [adminEmail, setAdminEmail] = useState<string | null>(null);

  /* Signed-in check. Runs before the PIN gate: asking for an admin PIN from a
     signed-out visitor is asking the wrong question of the wrong person. */
  /* The URL the panel used to live at. Bounced here rather than left to the
     redirect in app/admin/grant-coins/page.tsx, and the reason is ordering:
     that page renders inside this layout, so its `redirect()` arrives as an
     instruction in the RSC payload instead of an HTTP 307, and by the time the
     router applies it the gate below has already started — a signed-out visitor
     would be sent to /login from a URL that should simply have moved them.
     Doing it first means the old bookmark always lands on the Coins section. */
  const isLegacyGrantCoins = pathname === "/admin/grant-coins";

  useEffect(() => {
    if (isLegacyGrantCoins) {
      router.replace("/admin/coins");
    }
  }, [isLegacyGrantCoins, router]);

  useEffect(() => {
    if (isLegacyGrantCoins) return;
    let cancelled = false;
    async function check() {
      const session = await getCachedSession();
      if (cancelled) return;
      if (!session) {
        router.replace("/login");
        return;
      }

      /* The allowlist, checked locally first.

         This is the same check app/premium/page.tsx has always used to decide
         whether to show the Grant Coins shortcut, and it is exactly as
         unauthoritative as it ever was: both addresses ship in the public bundle
         and the server re-checks the email on every request. What it buys is
         that a signed-in user who is not on the list is told so immediately
         instead of being handed a PIN field that can only ever fail.

         It cannot lock anyone out either way — the server's answer is what
         actually decides, so an ADMIN_EMAILS override that the client bundle
         does not know about still gets through, just without the early screen. */
      if (!isAdminEmail(session.user.email, "client")) {
        setPhase("denied");
        return;
      }

      const stored = getStoredPin();
      if (!stored) {
        setPhase("unlock");
        return;
      }

      /* A stored PIN is a guess until the server agrees with it. Verified here
         rather than trusted, so a rotated ADMIN_GRANT_PIN sends the panel back to
         the unlock screen instead of failing on the first data request. */
      try {
        const result = await adminFetch<{ email: string | null }>("/api/admin/session", { pin: stored });
        if (cancelled) return;
        setAdminEmail(result.email);
        setPhase("ready");
      } catch (err) {
        if (cancelled) return;
        clearStoredPin();
        if (err instanceof AdminRequestError && err.misconfigured) {
          setError({ message: err.message, misconfigured: true });
          setPhase("error");
          return;
        }
        /* 403 is the allowlist, not the PIN: a different screen, because
           retyping cannot help. 401 stays the unlock screen. */
        if (err instanceof AdminRequestError && err.status === 403) {
          setPhase("denied");
          return;
        }
        setPhase("unlock");
      }
    }
    void check();
    return () => {
      cancelled = true;
    };
  }, [router, isLegacyGrantCoins]);

  /* A navigation closes the drawer, wired through the links rather than through
     an effect watching `pathname`: the tap is the event that should close it, and
     doing it there means no extra render pass per navigation. */
  const navigate = useCallback(
    (event: React.MouseEvent) => {
      /* Modified clicks and non-left buttons are the browser's business — a
         middle-click that opens a tab should not also close the drawer. */
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
      setDrawerOpen(false);
    },
    []
  );

  const submitPin = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      if (!pin.trim()) return;

      setVerifying(true);
      setError(null);
      try {
        const result = await adminFetch<{ email: string | null }>("/api/admin/session", { pin: pin.trim() });
        setStoredPin(pin.trim());
        setAdminEmail(result.email);
        setPhase("ready");
      } catch (err) {
        if (err instanceof AdminRequestError && err.status === 403) {
          setPhase("denied");
          return;
        }
        setError({
          message: err instanceof Error ? err.message : "Couldn't verify that PIN.",
          misconfigured: err instanceof AdminRequestError && err.misconfigured,
        });
      } finally {
        setVerifying(false);
      }
    },
    [pin]
  );

  const signOut = useCallback(async () => {
    clearStoredPin();
    await supabase.auth.signOut();
    router.replace("/login");
  }, [router]);

  const activeLabel = useMemo(
    () => SECTIONS.find((section) => isActive(pathname, section))?.label ?? "Admin",
    [pathname]
  );

  /* Nothing but the loader: the redirect is already queued, and painting the
     unlock or denied screen for one frame on the way out would be a lie about
     where the visitor is going. */
  if (isLegacyGrantCoins || phase === "checking") return <BrandedLoader />;

  if (phase === "error") {
    return (
      <main className="min-h-screen theme-bg-gradient px-4 py-16 text-white">
        <div className="mx-auto max-w-lg rounded-2xl border border-white/10 bg-[var(--admin-surface)]">
          <AdminErrorState
            message={error?.message ?? "The server is not configured for the admin panel."}
            misconfigured
          />
        </div>
      </main>
    );
  }

  /* Not on the allowlist. Shown instead of the PIN field, and it is a dead end
     on purpose: there is nothing to type, nothing to retry, and no path forward
     from this account. Sign out is offered because the usual reason to land here
     is being signed into the wrong one. */
  if (phase === "denied") {
    return (
      <main className="grid min-h-screen place-items-center px-5 theme-bg-gradient text-white">
        <div className="w-full max-w-sm rounded-[1.75rem] border border-white/10 bg-[var(--admin-surface)] p-7 text-center">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-red-500/15">
            <ShieldAlert size={26} className="text-red-300" />
          </div>

          <h1 className="mt-4 text-xl font-black">Not authorized</h1>
          <p className="mt-1.5 text-[13px] leading-relaxed text-[var(--admin-muted)]">
            This account isn&apos;t on the admin list. The panel is limited to the
            accounts that can grant coins, and that list is checked on the server
            for every request — not just here.
          </p>

          <AdminButton variant="primary" className="mt-5 w-full" onClick={signOut}>
            Sign out
          </AdminButton>

          <Link
            href="/contact-support"
            className="mt-3 block text-[12.5px] font-semibold text-[var(--admin-muted)] hover:text-white"
          >
            Think this is wrong? Contact support
          </Link>
          <Link
            href="/dashboard"
            className="mt-2 block text-[12.5px] font-semibold text-[var(--admin-muted)] hover:text-white"
          >
            Back to Whisper
          </Link>
        </div>
      </main>
    );
  }

  if (phase === "unlock") {
    return (
      <main className="grid min-h-screen place-items-center px-5 theme-bg-gradient text-white">
        <form
          onSubmit={submitPin}
          className="w-full max-w-sm rounded-[1.75rem] border border-white/10 bg-[var(--admin-surface)] p-7 text-center"
        >
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-purple-500/15">
            <ShieldCheck size={26} className="text-purple-300" />
          </div>

          <h1 className="mt-4 text-xl font-black">Admin access</h1>
          <p className="mt-1.5 text-[13px] leading-relaxed text-[var(--admin-muted)]">
            Enter the admin PIN. It is checked on the server with every request, not
            just to open this screen.
          </p>

          <input
            type="password"
            value={pin}
            onChange={(event) => setPin(event.target.value)}
            placeholder="Admin PIN"
            autoFocus
            autoComplete="current-password"
            aria-label="Admin PIN"
            className={`${adminInputClass} mt-5 text-center tracking-[0.3em]`}
          />

          {error && (
            <p role="alert" className="mt-3 text-[12.5px] font-semibold text-red-300">
              {error.message}
            </p>
          )}

          <AdminButton type="submit" variant="primary" disabled={verifying || !pin.trim()} className="mt-4 w-full">
            {verifying ? "Checking…" : "Unlock panel"}
          </AdminButton>

          <Link href="/dashboard" className="mt-4 block text-[12.5px] font-semibold text-[var(--admin-muted)] hover:text-white">
            Back to Whisper
          </Link>
        </form>
      </main>
    );
  }

  return (
    <div className="min-h-screen theme-bg-gradient text-white lg:flex">
      {/* ------------------------------------------------------------ */}
      {/* Mobile header                                                */}
      {/* ------------------------------------------------------------ */}
      <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-white/8 bg-[#07030f]/90 px-4 py-3 backdrop-blur-xl lg:hidden">
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          aria-label="Open admin navigation"
          className="grid h-9 w-9 place-items-center rounded-xl border border-white/10"
        >
          <BarChart3 size={17} />
        </button>
        <div className="min-w-0 flex-1 text-center">
          <p className="truncate text-[13px] font-bold">Whisper Admin</p>
          <p className="truncate text-[11px] text-[var(--admin-muted)]">{activeLabel}</p>
        </div>
        <button
          type="button"
          onClick={signOut}
          aria-label="Sign out"
          className="grid h-9 w-9 place-items-center rounded-xl border border-white/10"
        >
          <LogOut size={16} />
        </button>
      </header>

      {/* ------------------------------------------------------------ */}
      {/* Sidebar (desktop) / drawer (mobile)                          */}
      {/* ------------------------------------------------------------ */}
      <aside className="hidden w-60 flex-none border-r border-white/8 bg-[#07030f]/70 lg:sticky lg:top-0 lg:flex lg:h-screen lg:flex-col">
        <SidebarBody pathname={pathname} adminEmail={adminEmail} onSignOut={signOut} />
      </aside>

      <AnimatePresence>
        {drawerOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              onClick={() => setDrawerOpen(false)}
              className="fixed inset-0 z-40 bg-black/70 backdrop-blur-sm lg:hidden"
              aria-hidden
            />
            <motion.aside
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ type: "spring", stiffness: 380, damping: 34 }}
              className="fixed inset-y-0 left-0 z-50 flex w-[16.5rem] flex-col border-r border-white/10 bg-[#0a0518] lg:hidden"
              role="dialog"
              aria-label="Admin navigation"
            >
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                aria-label="Close navigation"
                className="absolute right-3 top-3 grid h-8 w-8 place-items-center rounded-lg border border-white/10"
              >
                <X size={15} />
              </button>
              <SidebarBody
                pathname={pathname}
                adminEmail={adminEmail}
                onSignOut={signOut}
                onNavigate={navigate}
              />
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* ------------------------------------------------------------ */}
      {/* Content                                                      */}
      {/* ------------------------------------------------------------ */}
      <main className="min-w-0 flex-1 px-4 py-5 sm:px-6 lg:px-8 lg:py-7">
        <div className="mx-auto w-full max-w-[1400px]">{children}</div>
      </main>
    </div>
  );
}

function SidebarBody({
  pathname,
  adminEmail,
  onSignOut,
  onNavigate,
}: {
  pathname: string;
  adminEmail: string | null;
  onSignOut: () => void;
  /** Present only in the drawer, where a navigation has to close it. */
  onNavigate?: (event: React.MouseEvent) => void;
}) {
  return (
    <>
      <div className="flex items-center gap-2.5 border-b border-white/8 px-5 py-4">
        <div className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-purple-500 to-fuchsia-600">
          <ShieldCheck size={17} className="text-white" />
        </div>
        <div className="min-w-0">
          <p className="truncate text-[13.5px] font-black leading-tight">Whisper Admin</p>
          <p className="truncate text-[11px] text-[var(--admin-muted)]">Control center</p>
        </div>
      </div>

      <nav className="flex-1 space-y-0.5 overflow-y-auto p-3" aria-label="Admin sections">
        {SECTIONS.map((section) => {
          const Icon = section.icon;
          const active = isActive(pathname, section);
          return (
            <Link
              key={section.href}
              href={section.href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={`flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-[13px] font-semibold transition ${
                active
                  ? "bg-purple-500/15 text-white"
                  : "text-[var(--admin-muted)] hover:bg-white/5 hover:text-white"
              }`}
            >
              <Icon size={16} className={active ? "text-purple-300" : ""} />
              <span className="truncate">{section.label}</span>
              {active && <span aria-hidden className="ml-auto h-1.5 w-1.5 rounded-full bg-purple-400" />}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-white/8 p-3">
        {adminEmail && (
          <p className="mb-2 truncate px-2 text-[11px] text-[var(--admin-muted)]" title={adminEmail}>
            {adminEmail}
          </p>
        )}
        <button
          type="button"
          onClick={onSignOut}
          className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-[13px] font-semibold text-[var(--admin-muted)] transition hover:bg-white/5 hover:text-white"
        >
          <LogOut size={16} />
          Sign out
        </button>
      </div>
    </>
  );
}
