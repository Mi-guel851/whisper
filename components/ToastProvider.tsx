"use client";

import { createContext, useCallback, useContext, useState } from "react";

type Toast = { id: number; message: string };

const ToastContext = createContext<{ showToast: (message: string) => void } | null>(null);

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx;
}

export default function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const showToast = useCallback((message: string) => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3000);
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div className="fixed bottom-6 left-6 z-[9999] flex flex-col gap-3">
        {toasts.map((t) => (
          <div
            key={t.id}
            className="animate-[slideIn_0.25s_ease-out] rounded-2xl border px-6 py-4 shadow-lg backdrop-blur-xl"
            style={{ background: "var(--theme-card)", borderColor: "var(--theme-accent)", color: "var(--theme-text-primary)", boxShadow: "var(--theme-shadow)" }}
          >
            {t.message}
          </div>
        ))}
      </div>
      <style jsx global>{`
        @keyframes slideIn {
          from {
            transform: translateX(-100%);
            opacity: 0;
          }
          to {
            transform: translateX(0);
            opacity: 1;
          }
        }
      `}</style>
    </ToastContext.Provider>
  );
}