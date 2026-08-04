"use client";

import { motion } from "framer-motion";
import { AlertTriangle } from "lucide-react";
import Modal from "./Modal";
import Button from "./Button";
import { spring } from "@/lib/motion";

export default function ConfirmDialog({
  title,
  description,
  confirmLabel = "Delete",
  cancelLabel = "Cancel",
  onConfirm,
  onCancel,
  loading = false,
  /** "danger" for destructive actions, "default" for benign confirmations. */
  tone = "danger",
  /** Callers that mount this conditionally can leave this at its default. */
  open = true,
}: {
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  loading?: boolean;
  tone?: "danger" | "default";
  open?: boolean;
}) {
  const accent =
    tone === "danger" ? "var(--theme-error)" : "var(--theme-accent-purple)";

  return (
    <Modal
      open={open}
      onClose={onCancel}
      size="sm"
      showClose={false}
      // A destructive choice should be answered, not dismissed by accident.
      dismissOnBackdrop={!loading}
    >
      <div className="flex flex-col items-center px-6 pb-6 pt-7 text-center">
        <motion.div
          className="grid h-12 w-12 place-items-center rounded-full"
          style={{ background: `color-mix(in srgb, ${accent} 14%, transparent)` }}
          initial={{ scale: 0.5, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ ...spring.bouncy, delay: 0.08 }}
        >
          <AlertTriangle size={22} style={{ color: accent }} />
        </motion.div>

        <h2
          className="mt-4 text-[1.125rem] font-bold"
          style={{ color: "var(--theme-text)", letterSpacing: "var(--tracking-lg)" }}
        >
          {title}
        </h2>
        <p
          className="mt-2 text-[0.875rem] leading-relaxed"
          style={{ color: "var(--theme-text-secondary)" }}
        >
          {description}
        </p>

        <div className="mt-6 flex w-full gap-3">
          <Button
            variant="ghost"
            onClick={onCancel}
            disabled={loading}
            fullWidth
            className="border"
            style={{ borderColor: "var(--theme-border)" }}
          >
            {cancelLabel}
          </Button>
          <Button
            variant={tone === "danger" ? "danger" : "primary"}
            onClick={onConfirm}
            loading={loading}
            fullWidth
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
