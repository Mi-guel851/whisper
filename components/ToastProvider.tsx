"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Info,
  Loader2,
} from "lucide-react";
import { spring, toastIn } from "@/lib/motion";

export type ToastVariant = "default" | "success" | "error" | "warning" | "info" | "loading";

export type ToastOptions = {
  variant?: ToastVariant;
  /** Milliseconds. Pass 0 to require manual dismissal (implied by "loading"). */
  duration?: number;
  description?: string;
  action?: { label: string; onClick: () => void };
};

type Toast = ToastOptions & {
  id: number;
  message: string;
  variant: ToastVariant;
  duration: number;
};

type ToastContextValue = {
  
  showToast: (message: string, options?: ToastOptions) => number;
  dismissToast: (id: number) => void;
  /** Replaces an existing toast in place — for "Uploading…" → "Uploaded". */
  updateToast: (id: number, message: string, options?: ToastOptions) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx;
}

const DEFAULT_DURATION = 3600;
const MAX_VISIBLE = 3;

const variantConfig: Record<
  ToastVariant,
  { icon: typeof Info | null; color: string }
> = {
  default: { icon: null, color: "var(--theme-accent-purple)" },
  success: { icon: CheckCircle2, color: "var(--theme-success)" },
  error: { icon: XCircle, color: "var(--theme-error)" },
  warning: { icon: AlertTriangle, color: "var(--theme-warning)" },
  info: { icon: Info, color: "var(--theme-info)" },
  loading: { icon: Loader2, color: "var(--theme-accent-purple)" },
};

export default function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  const counter = useRef(0);

  const dismissToast = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const scheduleDismiss = useCallback(
    (id: number, duration: number) => {
      const existing = timers.current.get(id);
      if (existing) clearTimeout(existing);
      if (duration <= 0) return;
      timers.current.set(
        id,
        setTimeout(() => dismissToast(id), duration)
      );
    },
    [dismissToast]
  );

  const showToast = useCallback(
    (message: string, options: ToastOptions = {}) => {
      const variant = options.variant ?? "default";
      // A loading toast has no natural end; the caller resolves it.
      const duration =
        options.duration ?? (variant === "loading" ? 0 : DEFAULT_DURATION);
      const id = ++counter.current;

      setToasts((current) => {
        const next = [...current, { ...options, id, message, variant, duration }];
        // Drop the oldest rather than stacking indefinitely off-screen.
        return next.slice(-MAX_VISIBLE);
      });

      scheduleDismiss(id, duration);
      return id;
    },
    [scheduleDismiss]
  );

  const updateToast = useCallback(
    (id: number, message: string, options: ToastOptions = {}) => {
      setToasts((current) =>
        current.map((toast) =>
          toast.id === id
            ? {
                ...toast,
                ...options,
                message,
                variant: options.variant ?? toast.variant,
                duration: options.duration ?? DEFAULT_DURATION,
              }
            : toast
        )
      );
      scheduleDismiss(id, options.duration ?? DEFAULT_DURATION);
    },
    [scheduleDismiss]
  );

  const value = useMemo(
    () => ({ showToast, dismissToast, updateToast }),
    [showToast, dismissToast, updateToast]
  );

  return (
    <ToastContext.Provider value={value}>
      {children}

      <div
        // pointer-events-none on the stack, auto on each toast, so the region
        // never blocks clicks on the page behind it.
        className="pointer-events-none fixed inset-x-0 bottom-0 z-[9999] flex flex-col items-center gap-2 px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:items-start sm:px-6"
        role="region"
        aria-label="Notifications"
      >
        <AnimatePresence initial={false} mode="popLayout">
          {toasts.map((toast) => (
            <ToastCard key={toast.id} toast={toast} onDismiss={dismissToast} />
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

function ToastCard({
  toast,
  onDismiss,
}: {
  toast: Toast;
  onDismiss: (id: number) => void;
}) {
  const { icon: Icon, color } = variantConfig[toast.variant];

  return (
    <motion.div
      layout
      variants={toastIn}
      initial="hidden"
      animate="visible"
      exit="exit"
      transition={spring.smooth}
      drag="x"
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={0.5}
      onDragEnd={(_, info) => {
        if (Math.abs(info.offset.x) > 90 || Math.abs(info.velocity.x) > 500) {
          onDismiss(toast.id);
        }
      }}
      role={toast.variant === "error" ? "alert" : "status"}
      aria-live={toast.variant === "error" ? "assertive" : "polite"}
      className="pointer-events-auto relative w-full max-w-[26rem] cursor-grab overflow-hidden rounded-[1.125rem] active:cursor-grabbing"
      style={{
        background: "var(--theme-glass-strong)",
        border: "1px solid var(--theme-glass-border)",
        boxShadow: "var(--elev-4), var(--elev-rim)",
        backdropFilter: "blur(28px) saturate(190%)",
        WebkitBackdropFilter: "blur(28px) saturate(190%)",
      }}
    >
      {/* Accent rail — carries the variant colour without tinting the glass. */}
      <span
        className="absolute inset-y-0 left-0 w-[3px]"
        style={{ background: color }}
      />

      <div className="flex items-start gap-3 py-3.5 pl-4 pr-3.5">
        {Icon && (
          <motion.span
            className="mt-px flex-none"
            style={{ color }}
            initial={{ scale: 0.4, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ ...spring.bouncy, delay: 0.06 }}
          >
            <Icon
              size={18}
              className={toast.variant === "loading" ? "animate-spin" : ""}
            />
          </motion.span>
        )}

        <div className="min-w-0 flex-1">
          <p
            className="text-[0.875rem] font-semibold leading-snug"
            style={{ color: "var(--theme-text)" }}
          >
            {toast.message}
          </p>
          {toast.description && (
            <p
              className="mt-0.5 text-[0.8125rem] leading-snug"
              style={{ color: "var(--theme-text-secondary)" }}
            >
              {toast.description}
            </p>
          )}
        </div>

        {toast.action && (
          <button
            type="button"
            onClick={() => {
              toast.action?.onClick();
              onDismiss(toast.id);
            }}
            className="flex-none rounded-lg px-2.5 py-1 text-[0.8125rem] font-bold transition-colors"
            style={{ color }}
          >
            {toast.action.label}
          </button>
        )}
      </div>

      {/* Auto-dismiss progress. Linear on purpose — an eased countdown
          misrepresents how much time is actually left. */}
      {toast.duration > 0 && (
        <motion.span
          className="absolute inset-x-0 bottom-0 h-[2px] origin-left"
          style={{ background: color, opacity: 0.55 }}
          initial={{ scaleX: 1 }}
          animate={{ scaleX: 0 }}
          transition={{ duration: toast.duration / 1000, ease: "linear" }}
        />
      )}
    </motion.div>
  );
}
