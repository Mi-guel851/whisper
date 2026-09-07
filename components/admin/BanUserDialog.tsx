"use client";

import { useRef, useState } from "react";
import { Loader2, ShieldOff } from "lucide-react";

import Modal from "@/components/Modal";
import { AdminButton, AdminField, adminInputClass } from "@/components/admin/primitives";
import { adminFetch } from "@/lib/admin/client";
import { runAdminAction } from "@/lib/admin/useAdminData";

/**
 * The ban confirmation.
 *
 * It asks for a reason and a duration, and it does not have a "just do it" path:
 * the submit button stays disabled until a reason exists. A ban with no reason is
 * unappealable for the person it lands on and unreadable for the next admin, and
 * "Violation of the guidelines" pre-filled would make the field decorative — so
 * the field is empty and required instead.
 *
 * WHAT "BAN" DOES
 *
 * POST /api/admin/bans writes a `user_bans` row and asks GoTrue to set
 * `banned_until`. The row is what actually stops the account: before-insert
 * triggers on messages, direct_messages, public_feed_posts, likes, reactions and
 * coin_transactions refuse it (202609080001 §B2). Nothing is deleted, and
 * `DELETE /api/admin/bans/:id` puts it all back.
 */

const DURATIONS = [
  { key: "permanent", label: "Permanent" },
  { key: "1h", label: "1 hour" },
  { key: "24h", label: "24 hours" },
  { key: "7d", label: "7 days" },
  { key: "30d", label: "30 days" },
  { key: "90d", label: "90 days" },
];

export default function BanUserDialog({
  userId,
  username,
  onClose,
  onDone,
}: {
  userId: string;
  username: string;
  onClose: () => void;
  /** Called with the enforcement outcome so the caller can say which happened. */
  onDone: (result: { sessionsRevoked: boolean }) => void;
}) {
  /* The caller mounts this only while a ban is being confirmed, and keys it by
     the account, so a fresh mount is what clears the form. That is why there is
     no reset effect here: a reason typed for one account cannot survive into the
     next one because the component does not survive either. */
  const [reason, setReason] = useState("");
  const [duration, setDuration] = useState("permanent");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reasonRef = useRef<HTMLTextAreaElement>(null);

  async function submit() {
    const trimmed = reason.trim();
    if (!trimmed) {
      setError("A reason is required.");
      return;
    }

    setBusy(true);
    setError(null);

    const result = await runAdminAction(() =>
      adminFetch<{ sessionsRevoked: boolean; revokeError?: string | null }>("/api/admin/bans", {
        method: "POST",
        body: { userId, reason: trimmed, duration },
      })
    );

    setBusy(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }

    onDone({ sessionsRevoked: result.value.sessionsRevoked });
  }

  return (
    <Modal
      open
      onClose={busy ? () => undefined : onClose}
      title="Ban user"
      description={`You are about to prevent @${username} from using Whisper.`}
      size="md"
      dismissOnBackdrop={!busy}
      showClose={!busy}
      initialFocus={reasonRef}
    >
      <div className="space-y-4 px-5 pb-5">
        <div className="flex items-start gap-3 rounded-xl border border-red-500/20 bg-red-500/8 p-3.5">
          <ShieldOff size={17} className="mt-0.5 flex-none text-red-300" />
          <p className="text-[12.5px] leading-relaxed text-red-100/90">
            They will not be able to send whispers, messages or posts, react to
            anything, or move coins. Their data is not deleted, and this can be
            reversed at any time.
          </p>
        </div>

        <AdminField label="Reason" hint="Shown to the user on their ban screen.">
          <textarea
            ref={reasonRef}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            rows={3}
            maxLength={500}
            placeholder="Repeated harassment of other users after a warning"
            className={`${adminInputClass} resize-none`}
          />
        </AdminField>

        <AdminField label="Duration">
          <select
            value={duration}
            onChange={(event) => setDuration(event.target.value)}
            className={adminInputClass}
          >
            {DURATIONS.map((option) => (
              <option key={option.key} value={option.key} className="bg-[#100b1e]">
                {option.label}
              </option>
            ))}
          </select>
        </AdminField>

        {error && (
          <p role="alert" className="text-[12.5px] font-semibold text-red-300">
            {error}
          </p>
        )}

        <div className="flex items-center justify-end gap-2 pt-1">
          <AdminButton variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </AdminButton>
          <AdminButton variant="danger" onClick={submit} disabled={busy || !reason.trim()}>
            {busy && <Loader2 size={14} className="animate-spin" />}
            {busy ? "Banning…" : "Ban user"}
          </AdminButton>
        </div>
      </div>
    </Modal>
  );
}
