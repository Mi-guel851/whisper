"use client";

import { useRef, useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";

import Modal from "@/components/Modal";
import { AdminButton, AdminField, adminInputClass } from "@/components/admin/primitives";
import { adminFetch, type AdminAnnouncement } from "@/lib/admin/client";
import { runAdminAction } from "@/lib/admin/useAdminData";

/**
 * The announcement composer. One component for create and edit.
 *
 * The field rules here mirror lib/admin/announcements.ts, which is what the server
 * validates against — but the server's word is the one that counts. This form can
 * be bypassed with a hand-written request, and the route would still refuse a CTA to
 * an arbitrary domain, a poll with one option, or an end time before its start time.
 *
 * AUDIENCES
 *
 * "Specific users" is capped at 500 ids and takes ids, not usernames, because a
 * targeted announcement is a moderation action taken from an account page, not a
 * mailing list built by typing names.
 */

const KINDS = [
  { key: "info", label: "Update" },
  { key: "cta", label: "Promotion" },
  { key: "poll", label: "Poll" },
  { key: "maintenance", label: "Maintenance" },
] as const;

const AUDIENCES = [
  { key: "everyone", label: "Everyone" },
  { key: "new_users", label: "New users (14d)" },
  { key: "active_users", label: "Active (posted or messaged in 7d)" },
  { key: "inactive_users", label: "Inactive (nothing in 14d)" },
  { key: "specific_users", label: "Specific accounts" },
  { key: "banned_users", label: "Banned accounts" },
] as const;

/** Shown under the destination field so the rule is visible, not discovered. */
const CTA_HINT =
  "A Whisper page (/dashboard, /public-feed, /premium, /contact-support, /u/username, …) or an https link to a domain Whisper already links to.";

type Draft = {
  kind: string;
  title: string;
  body: string;
  imageUrl: string;
  ctaLabel: string;
  ctaHref: string;
  audience: string;
  audienceIds: string;
  startsAt: string;
  endsAt: string;
  pollOptions: string[];
  active: boolean;
};

const EMPTY_DRAFT: Draft = {
  kind: "info",
  title: "",
  body: "",
  imageUrl: "",
  ctaLabel: "",
  ctaHref: "",
  audience: "everyone",
  audienceIds: "",
  startsAt: "",
  endsAt: "",
  pollOptions: ["", ""],
  active: false,
};

/** `2026-09-10T18:00:00.000Z` → the value `datetime-local` expects (local time). */
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(
    date.getMinutes()
  )}`;
}

/**
 * The row being edited turned into form state, or a blank form for a new one.
 *
 * Pulled out as a function so it can be handed to `useState` as an initializer
 * rather than run inside an effect. That is not a stylistic preference: an
 * effect that resets state on open is a second render pass after the sheet is
 * already painted, and it is the kind of thing that flashes an empty form for a
 * frame on a slow device.
 */
function draftFrom(announcement: AdminAnnouncement | null): Draft {
  if (!announcement) return EMPTY_DRAFT;
  return {
    kind: announcement.kind,
    title: announcement.title,
    body: announcement.body,
    imageUrl: announcement.image_url ?? "",
    ctaLabel: announcement.cta_label ?? "",
    ctaHref: announcement.cta_href ?? "",
    audience: announcement.audience,
    audienceIds: (announcement.audience_ids ?? []).join("\n"),
    startsAt: toLocalInput(announcement.starts_at),
    endsAt: toLocalInput(announcement.ends_at),
    pollOptions: announcement.poll_options?.length ? announcement.poll_options : ["", ""],
    active: announcement.active,
  };
}

export default function AnnouncementEditor({
  announcement,
  onClose,
  onSaved,
}: {
  /** When set, this is an edit of that row rather than a new one. */
  announcement: AdminAnnouncement | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  /* Seeded once, on mount. The caller mounts this only while the sheet is open
     and keys it by the announcement, so opening a different row is a different
     component — which is what makes a reset effect unnecessary, and what stops a
     half-edited draft leaking from one announcement into the next. */
  const [draft, setDraft] = useState<Draft>(() => draftFrom(announcement));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  async function save() {
    setBusy(true);
    setError(null);

    /* Whitespace and empty poll options are dropped here so the payload the
       server validates is the one the admin meant, not the one they left behind. */
    const payload = {
      kind: draft.kind,
      title: draft.title.trim(),
      body: draft.body.trim(),
      imageUrl: draft.imageUrl.trim(),
      ctaLabel: draft.ctaLabel.trim(),
      ctaHref: draft.ctaHref.trim(),
      audience: draft.audience,
      audienceIds: draft.audienceIds
        .split(/[\s,]+/)
        .map((value) => value.trim())
        .filter(Boolean),
      startsAt: draft.startsAt,
      endsAt: draft.endsAt,
      pollOptions: draft.pollOptions.map((option) => option.trim()).filter(Boolean),
      active: draft.active,
    };

    const result = await runAdminAction<{ ok?: boolean; id?: string }>(() =>
      announcement
        ? adminFetch<{ ok: boolean }>(`/api/admin/announcements/${announcement.id}`, {
            method: "PATCH",
            body: payload,
          })
        : adminFetch<{ id: string }>("/api/admin/announcements", { method: "POST", body: payload })
    );

    setBusy(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }

    onSaved();
  }

  const isPoll = draft.kind === "poll";

  return (
    <Modal
      open
      onClose={busy ? () => undefined : onClose}
      title={announcement ? "Edit announcement" : "New announcement"}
      description={
        announcement
          ? "Changes apply immediately if the announcement is live."
          : "Save as a draft to schedule it, or publish straight away."
      }
      size="lg"
      dismissOnBackdrop={!busy}
      showClose={!busy}
      initialFocus={titleRef}
    >
      <div className="max-h-[70vh] space-y-4 overflow-y-auto px-5 pb-5">
        <AdminField label="Type">
          <div className="flex flex-wrap gap-2">
            {KINDS.map((kind) => (
              <button
                key={kind.key}
                type="button"
                onClick={() => set("kind", kind.key)}
                aria-pressed={draft.kind === kind.key}
                className={`rounded-full px-3.5 py-1.5 text-[12px] font-bold transition ${
                  draft.kind === kind.key
                    ? "bg-purple-500/20 text-purple-200"
                    : "border border-white/10 text-[var(--admin-muted)] hover:text-white"
                }`}
              >
                {kind.label}
              </button>
            ))}
          </div>
        </AdminField>

        <AdminField label="Title">
          <input
            ref={titleRef}
            value={draft.title}
            onChange={(event) => set("title", event.target.value)}
            maxLength={80}
            placeholder="Whisper Update"
            className={adminInputClass}
          />
        </AdminField>

        <AdminField label="Message" hint={`${draft.body.length}/600`}>
          <textarea
            value={draft.body}
            onChange={(event) => set("body", event.target.value)}
            rows={4}
            maxLength={600}
            placeholder="We just launched a new way to discover anonymous conversations."
            className={`${adminInputClass} resize-none`}
          />
        </AdminField>

        <AdminField label="Illustration URL" hint="Optional. A /public path or a Cloudinary https URL.">
          <input
            value={draft.imageUrl}
            onChange={(event) => set("imageUrl", event.target.value)}
            placeholder="/ghost.png"
            className={adminInputClass}
          />
        </AdminField>

        <div className="grid gap-4 sm:grid-cols-2">
          <AdminField label="Button label" hint="Optional. Leave both blank for no button.">
            <input
              value={draft.ctaLabel}
              onChange={(event) => set("ctaLabel", event.target.value)}
              maxLength={40}
              placeholder="Explore now"
              className={adminInputClass}
            />
          </AdminField>
          <AdminField label="Button destination" hint={CTA_HINT}>
            <input
              value={draft.ctaHref}
              onChange={(event) => set("ctaHref", event.target.value)}
              placeholder="/public-feed"
              className={adminInputClass}
            />
          </AdminField>
        </div>

        {isPoll && (
          <AdminField label="Poll options" hint="Two to six. Voting is limited to one per person, enforced in the database.">
            <div className="space-y-2">
              {draft.pollOptions.map((option, index) => (
                <div key={index} className="flex items-center gap-2">
                  <input
                    value={option}
                    onChange={(event) =>
                      set(
                        "pollOptions",
                        draft.pollOptions.map((existing, i) => (i === index ? event.target.value : existing))
                      )
                    }
                    maxLength={60}
                    placeholder={`Option ${index + 1}`}
                    className={adminInputClass}
                  />
                  {draft.pollOptions.length > 2 && (
                    <button
                      type="button"
                      onClick={() => set("pollOptions", draft.pollOptions.filter((_, i) => i !== index))}
                      aria-label={`Remove option ${index + 1}`}
                      className="flex-none rounded-lg p-2 text-[var(--admin-muted)] transition hover:bg-white/6 hover:text-red-300"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              ))}

              {draft.pollOptions.length < 6 && (
                <AdminButton
                  variant="ghost"
                  onClick={() => set("pollOptions", [...draft.pollOptions, ""])}
                >
                  <Plus size={13} />
                  Add option
                </AdminButton>
              )}
            </div>
          </AdminField>
        )}

        <AdminField label="Audience">
          <select
            value={draft.audience}
            onChange={(event) => set("audience", event.target.value)}
            className={adminInputClass}
          >
            {AUDIENCES.map((audience) => (
              <option key={audience.key} value={audience.key} className="bg-[#100b1e]">
                {audience.label}
              </option>
            ))}
          </select>
        </AdminField>

        {draft.audience === "specific_users" && (
          <AdminField label="Account ids" hint="One per line or comma-separated. Maximum 500.">
            <textarea
              value={draft.audienceIds}
              onChange={(event) => set("audienceIds", event.target.value)}
              rows={4}
              placeholder="0b8f1c2e-…"
              className={`${adminInputClass} resize-none font-mono text-[12px]`}
            />
          </AdminField>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <AdminField label="Starts at" hint="Blank means immediately.">
            <input
              type="datetime-local"
              value={draft.startsAt}
              onChange={(event) => set("startsAt", event.target.value)}
              className={adminInputClass}
            />
          </AdminField>
          <AdminField label="Ends at" hint="Blank means it runs until you disable it.">
            <input
              type="datetime-local"
              value={draft.endsAt}
              onChange={(event) => set("endsAt", event.target.value)}
              className={adminInputClass}
            />
          </AdminField>
        </div>

        <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-white/10 p-3.5">
          <input
            type="checkbox"
            checked={draft.active}
            onChange={(event) => set("active", event.target.checked)}
            className="h-4 w-4 accent-purple-500"
          />
          <span>
            <span className="block text-[13px] font-bold text-white">Publish</span>
            <span className="block text-[11.5px] text-[var(--admin-muted)]">
              Off saves it as a draft. A future start time schedules it.
            </span>
          </span>
        </label>

        {error && (
          <p role="alert" className="text-[12.5px] font-semibold text-red-300">
            {error}
          </p>
        )}

        <div className="flex items-center justify-end gap-2 pt-1">
          <AdminButton variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </AdminButton>
          <AdminButton variant="primary" onClick={save} disabled={busy || !draft.title.trim() || !draft.body.trim()}>
            {busy && <Loader2 size={14} className="animate-spin" />}
            {busy ? "Saving…" : announcement ? "Save changes" : draft.active ? "Publish" : "Save draft"}
          </AdminButton>
        </div>
      </div>
    </Modal>
  );
}
