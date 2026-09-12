/**
 * Toasts — the conventional import path.
 *
 * The toast system itself lives in `lib/toast.tsx`: one provider mounted in the
 * root layout, one `useToast()` hook every screen calls, one toast on screen at
 * a time. This file exists so the component layer has the path its name implies
 * — `components/Toast` — without a second implementation of the same thing,
 * which is how two toasts that look different end up in one app.
 *
 * Import from either path; they are the same module.
 */
export { ToastProvider, useToast } from "@/lib/toast";
export type { ToastVariant } from "@/lib/toast";
