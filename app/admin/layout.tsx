import AdminShell from "@/components/admin/AdminShell";

/**
 * Every /admin route renders inside the shell.
 *
 * This is a layout and not a per-page wrapper so that navigation between
 * sections does not remount the sidebar, the unlock state or the drawer — and so
 * that a new section cannot be added without the gate, which is the failure mode
 * a shared shell exists to prevent.
 *
 * It is a client component (AdminShell carries "use client") because the Supabase
 * session lives in localStorage, so the auth check cannot run on the server. That
 * is a UX consequence, not a security one: every API route the panel calls
 * re-verifies the account and the PIN itself, and every admin RPC is
 * EXECUTE-revoked from `anon` and `authenticated`, so a browser that skips this
 * layout entirely still cannot reach any admin data.
 */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <AdminShell>{children}</AdminShell>;
}
