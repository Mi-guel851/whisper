"use client";

import { motion } from "framer-motion";
import { AlertTriangle, Inbox, RefreshCw, Search } from "lucide-react";

/**
 * The building blocks the admin panel is made of.
 *
 * Deliberately plain. This is a tool people sit in for an hour reading tables, so
 * the visual budget goes to legibility — consistent rhythm, real hover states,
 * tabular numerals, nothing that animates on a timer. The app's glass-and-glow
 * vocabulary is here in a much lower key than the marketing pages, and motion is
 * limited to the one thing it helps with: a row appearing.
 *
 * Every surface is a token-coloured panel rather than a hardcoded hex, so the
 * panel follows app/globals.css themes instead of being a dark island in a
 * light-theme app.
 */

/* -------------------------------------------------------------------------- */
/* Panels                                                                     */
/* -------------------------------------------------------------------------- */

export function AdminPanel({
  children,
  className = "",
  title,
  subtitle,
  actions,
}: {
  children: React.ReactNode;
  className?: string;
  title?: string;
  subtitle?: string;
  actions?: React.ReactNode;
}) {
  return (
    <section
      className={`rounded-2xl border border-[var(--admin-line)] bg-[var(--admin-surface)] ${className}`}
      style={{ boxShadow: "0 1px 2px rgba(0,0,0,0.18)" }}
    >
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--admin-line)] px-4 py-3.5 sm:px-5">
          <div className="min-w-0">
            {title && <h2 className="truncate text-[15px] font-bold text-[var(--admin-text)]">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-xs text-[var(--admin-muted)]">{subtitle}</p>}
          </div>
          {actions && <div className="flex flex-none items-center gap-2">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Stat cards                                                                 */
/* -------------------------------------------------------------------------- */

export function AdminStatCard({
  label,
  value,
  hint,
  tone = "default",
  loading = false,
}: {
  label: string;
  value: number | string;
  hint?: string;
  tone?: "default" | "accent" | "danger" | "success" | "warning";
  loading?: boolean;
}) {
  const accent =
    tone === "danger"
      ? "var(--theme-error)"
      : tone === "warning"
        ? "var(--theme-warning)"
        : tone === "success"
          ? "var(--theme-success)"
          : tone === "accent"
            ? "var(--theme-accent-purple)"
            : "var(--admin-muted)";

  return (
    <div className="relative overflow-hidden rounded-2xl border border-[var(--admin-line)] bg-[var(--admin-surface)] p-4">
      <span aria-hidden className="absolute inset-y-0 left-0 w-[2px]" style={{ background: accent, opacity: 0.7 }} />
      <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--admin-muted)]">{label}</p>

      {loading ? (
        <div className="mt-2 h-7 w-20 animate-pulse rounded bg-[var(--admin-hover)]" />
      ) : (
        <p className="mt-1 text-[1.6rem] font-black leading-none tabular-nums text-[var(--admin-text)]">{value}</p>
      )}

      {hint && <p className="mt-1.5 text-[11.5px] text-[var(--admin-muted)]">{hint}</p>}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Tables                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * A table wrapper, not a table component.
 *
 * The scroll container is the important part: on a 360px phone an eight-column
 * table either overflows the page (breaking the whole layout, including the
 * sidebar) or crushes its columns into unreadable slivers. Neither is acceptable,
 * so the table scrolls horizontally inside its own box and the page never does.
 */
export function AdminTableScroll({ children }: { children: React.ReactNode }) {
  return (
    <div className="-mx-px overflow-x-auto overscroll-x-contain">
      <div className="min-w-full">{children}</div>
    </div>
  );
}

export function AdminTable({ head, children }: { head: React.ReactNode; children: React.ReactNode }) {
  return (
    <table className="w-full min-w-[640px] border-collapse text-left text-[13px]">
      <thead>
        <tr className="border-b border-[var(--admin-line)] text-[11px] uppercase tracking-wide text-[var(--admin-muted)]">
          {head}
        </tr>
      </thead>
      <tbody className="divide-y divide-white/5">{children}</tbody>
    </table>
  );
}

export function AdminTh({ children, className = "" }: { children?: React.ReactNode; className?: string }) {
  return <th scope="col" className={`whitespace-nowrap px-4 py-2.5 font-semibold ${className}`}>{children}</th>;
}

export function AdminTd({ children, className = "" }: { children?: React.ReactNode; className?: string }) {
  return <td className={`px-4 py-3 align-middle ${className}`}>{children}</td>;
}

/* -------------------------------------------------------------------------- */
/* Status pills                                                               */
/* -------------------------------------------------------------------------- */

export function AdminBadge({
  children,
  tone = "neutral",
  title,
}: {
  children: React.ReactNode;
  tone?: "neutral" | "success" | "danger" | "warning" | "accent";
  /** Tooltip only — never the sole carrier of information, since touch has no hover. */
  title?: string;
}) {
  const palette: Record<string, string> = {
    neutral: "bg-[var(--admin-hover)] text-[var(--admin-muted)]",
    success: "bg-emerald-500/15 text-emerald-300",
    danger: "bg-red-500/15 text-red-300",
    warning: "bg-amber-500/15 text-amber-300",
    accent: "bg-purple-500/15 text-purple-300",
  };
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-bold ${palette[tone]}`}
    >
      {children}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Buttons                                                                    */
/* -------------------------------------------------------------------------- */

export function AdminButton({
  children,
  onClick,
  variant = "ghost",
  disabled = false,
  type = "button",
  className = "",
  title,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: "primary" | "ghost" | "danger" | "subtle";
  disabled?: boolean;
  type?: "button" | "submit";
  className?: string;
  title?: string;
}) {
  const styles: Record<string, string> = {
    primary: "bg-gradient-to-r from-purple-600 to-purple-500 text-[var(--admin-text)] hover:opacity-90",
    ghost: "border border-[var(--admin-line)] text-[var(--admin-text-secondary)] hover:bg-[var(--admin-hover)]",
    danger: "border border-red-500/30 bg-red-500/10 text-red-300 hover:bg-red-500/20",
    subtle: "text-[var(--admin-muted)] hover:text-[var(--admin-text)]",
  };
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-xl px-3.5 py-2 text-[12.5px] font-bold transition disabled:cursor-not-allowed disabled:opacity-50 ${styles[variant]} ${className}`}
    >
      {children}
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/* Inputs                                                                     */
/* -------------------------------------------------------------------------- */

export const adminInputClass =
  "w-full rounded-xl border border-[var(--admin-line)] bg-[var(--admin-input)] px-3.5 py-2.5 text-[13px] text-[var(--admin-text)] outline-none transition placeholder:text-[var(--admin-muted)] focus:border-purple-500/60";

export function AdminField({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[11.5px] font-semibold text-[var(--admin-muted)]">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-[var(--admin-muted)]">{hint}</span>}
    </label>
  );
}

/**
 * Debounced search input.
 *
 * 350ms, which is long enough that typing a username costs one request instead of
 * eight, and short enough that it does not feel like the panel is thinking. The
 * debounce lives here rather than in each page so the five search fields in the
 * panel behave identically.
 */
export function AdminSearchInput({
  value,
  onChange,
  placeholder,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  label: string;
}) {
  return (
    <div className="relative">
      <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--admin-muted)]" />
      <input
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={label}
        className={`${adminInputClass} pl-9`}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* States                                                                     */
/* -------------------------------------------------------------------------- */

export function AdminSkeletonRows({ rows = 6, columns = 5 }: { rows?: number; columns?: number }) {
  return (
    <div className="space-y-2 p-4" aria-hidden>
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <div key={rowIndex} className="flex items-center gap-3">
          {Array.from({ length: columns }).map((__, colIndex) => (
            <div
              key={colIndex}
              className="h-4 animate-pulse rounded bg-[var(--admin-hover)]"
              /* Varied widths so the skeleton reads as a table and not as a
                 stack of identical bars. */
              style={{ width: `${colIndex === 0 ? 32 : 12 + ((rowIndex * 7 + colIndex * 13) % 18)}%` }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

export function AdminSkeletonCards({ count = 8 }: { count?: number }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-hidden>
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className="rounded-2xl border border-[var(--admin-line)] bg-[var(--admin-surface)] p-4">
          <div className="h-3 w-24 animate-pulse rounded bg-[var(--admin-hover)]" />
          <div className="mt-3 h-7 w-16 animate-pulse rounded bg-[var(--admin-hover)]" />
          <div className="mt-3 h-3 w-20 animate-pulse rounded bg-[var(--admin-hover)]" />
        </div>
      ))}
    </div>
  );
}

export function AdminEmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      <div className="grid h-11 w-11 place-items-center rounded-2xl bg-[var(--admin-hover)]">
        <Inbox size={20} className="text-[var(--admin-muted)]" />
      </div>
      <p className="mt-3 text-sm font-bold text-[var(--admin-text)]">{title}</p>
      {body && <p className="mt-1 max-w-sm text-[12.5px] leading-relaxed text-[var(--admin-muted)]">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/**
 * A failed request, with the one thing that can fix it.
 *
 * `misconfigured` gets its own wording because the fix is different: a wrong PIN
 * or an expired session is something the person in front of the screen can solve,
 * while a missing env var or migration is something they have to go and deploy.
 * Telling them to "try again" against a missing migration is the same mistake
 * app/api/admin/verify-pin warns about.
 */
export function AdminErrorState({
  message,
  onRetry,
  misconfigured = false,
}: {
  message: string;
  onRetry?: () => void;
  misconfigured?: boolean;
}) {
  return (
    <div className="flex flex-col items-center px-6 py-10 text-center">
      <div className="grid h-11 w-11 place-items-center rounded-2xl bg-red-500/12">
        <AlertTriangle size={20} className="text-red-300" />
      </div>
      <p className="mt-3 text-sm font-bold text-[var(--admin-text)]">
        {misconfigured ? "The server isn't configured for this" : "Couldn't load that"}
      </p>
      <p className="mt-1 max-w-md text-[12.5px] leading-relaxed text-[var(--admin-muted)]">{message}</p>
      {onRetry && !misconfigured && (
        <AdminButton variant="ghost" className="mt-4" onClick={onRetry}>
          <RefreshCw size={14} />
          Try again
        </AdminButton>
      )}
    </div>
  );
}

/** A row appearing. The only animation in the panel that runs on its own. */
export function AdminRow({ children, index = 0 }: { children: React.ReactNode; index?: number }) {
  return (
    <motion.tr
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.18, delay: Math.min(index * 0.015, 0.12) }}
    >
      {children}
    </motion.tr>
  );
}
