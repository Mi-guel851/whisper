"use client";

import Link from "next/link";
import Image from "next/image";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import {
  AtSign,
  ChevronRight,
  FileText,
  LifeBuoy,
  Lightbulb,
  Palette,
  Save,
  ScrollText,
  Settings,
  ShieldCheck,
  Sparkles,
  User,
  type LucideIcon,
} from "lucide-react";

import { supabase } from "@/lib/supabase/client";
import { useTheme } from "@/components/ThemeProvider";
import { useToast } from "@/components/ToastProvider";
import BottomNavigation from "@/components/BottomNavigation";
import BackButton from "@/components/BackButton";
import AvatarUpload from "@/components/AvatarUpload";
import LogoutButton from "@/components/LogoutButton";
import EdgeLitCard from "@/components/EdgeLitCard";
import Button from "@/components/Button";
import { Skeleton, SkeletonText } from "@/components/Skeleton";
import { staggerContainer, staggerItem, tween } from "@/lib/motion";
import { useSafeReducedMotion } from "@/lib/useSafeReducedMotion";
import { PROSE_INPUT_PROPS } from "@/lib/textEntry";

const BIO_LIMIT = 140;
const USERNAME_MIN = 3;

type ProfileFields = {
  displayName: string;
  username: string;
  bio: string;
};

const EMPTY_PROFILE: ProfileFields = { displayName: "", username: "", bio: "" };

type AccountLink = {
  href: string;
  icon: LucideIcon;
  label: string;
  /** Static description, or one derived from live state. */
  detail: string | ((ctx: { themeName: string }) => string);
};

const ACCOUNT_LINKS: AccountLink[] = [
  {
    href: "/appearance",
    icon: Palette,
    label: "Appearance",
    detail: ({ themeName }) => themeName,
  },
  {
    href: "/settings",
    icon: Settings,
    label: "Settings",
    detail: "Adjust account preferences",
  },
  {
    href: "/feedback",
    icon: Lightbulb,
    label: "Feedback",
    detail: "Share your thoughts",
  },
  {
    href: "/contact-support",
    icon: LifeBuoy,
    label: "Contact Support",
    detail: "Get help with your account",
  },
  {
    href: "/community-guidelines",
    icon: ScrollText,
    label: "Community Guidelines",
    detail: "Read the rules",
  },
  {
    href: "/privacy",
    icon: ShieldCheck,
    label: "Privacy Policy",
    detail: "How your data is handled",
  },
  {
    href: "/terms",
    icon: FileText,
    label: "Terms of Service",
    detail: "Read the app terms",
  },
];

export default function ProfilePage() {
  const router = useRouter();
  const { showToast } = useToast();
  const { theme } = useTheme();
  const reduced = useSafeReducedMotion();

  const [fields, setFields] = useState<ProfileFields>(EMPTY_PROFILE);
  // The last persisted values. Diffing against this drives the Save button's
  // enabled state — a save button that's always live invites no-op writes and
  // gives no signal that anything actually changed.
  const [saved, setSaved] = useState<ProfileFields>(EMPTY_PROFILE);
  const [saving, setSaving] = useState(false);
  const [initialLoad, setInitialLoad] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function loadProfile() {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        router.push("/login");
        return;
      }

      const { data } = await supabase
        .from("profiles")
        .select("display_name, username, bio")
        .eq("id", session.user.id)
        .single();

      if (cancelled) return;

      if (data) {
        const next: ProfileFields = {
          displayName: data.display_name || "",
          username: data.username || "",
          bio: data.bio || "",
        };
        setFields(next);
        setSaved(next);
      }
      setInitialLoad(false);
    }

    loadProfile();
    return () => {
      cancelled = true;
    };
  }, [router]);

  const update = useCallback(
    <K extends keyof ProfileFields>(key: K, value: ProfileFields[K]) => {
      setFields((current) => ({ ...current, [key]: value }));
    },
    []
  );

  const usernameError = useMemo(() => {
    if (!fields.username) return null;
    if (fields.username.length < USERNAME_MIN) {
      return `At least ${USERNAME_MIN} characters`;
    }
    return null;
  }, [fields.username]);

  const dirty =
    fields.displayName !== saved.displayName ||
    fields.username !== saved.username ||
    fields.bio !== saved.bio;

  const canSave = dirty && !usernameError && !saving && !initialLoad;

  async function saveProfile() {
    if (!canSave) return;

    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) return;

    setSaving(true);
    const payload = {
      display_name: fields.displayName.trim(),
      username: fields.username,
      bio: fields.bio.trim(),
    };
    const { error } = await supabase
      .from("profiles")
      .update(payload)
      .eq("id", session.user.id);
    setSaving(false);

    if (error) {
      // 23505 is Postgres' unique_violation — the one failure here a user can
      // actually act on, so it gets a message they can act on.
      const duplicate =
        error.code === "23505" || /duplicate|unique/i.test(error.message);
      showToast(duplicate ? "That username is already taken." : error.message, {
        variant: "error",
      });
      return;
    }

    setSaved({
      displayName: payload.display_name,
      username: payload.username,
      bio: payload.bio,
    });
    // Reflect the trim back into the inputs, or the fields stay "dirty"
    // against their own saved values forever.
    setFields((current) => ({
      ...current,
      displayName: payload.display_name,
      bio: payload.bio,
    }));
    showToast("Profile updated 👤", { variant: "success" });
  }

  const bioRemaining = BIO_LIMIT - fields.bio.length;

  return (
    <main className="min-h-screen w-full overflow-x-clip theme-bg-gradient text-white pb-28">
      <motion.div
        className="mx-auto w-full max-w-xl px-4 py-6 sm:px-6"
        variants={staggerContainer(0.06)}
        initial="hidden"
        animate="visible"
      >
        <motion.div variants={staggerItem} className="flex items-center gap-3">
          <BackButton className="" />
          <div className="flex items-center gap-2">
            <Image src="/ghost.png" alt="" width={24} height={24} />
            <span className="text-sm font-black tracking-wide">WHISPER</span>
          </div>
        </motion.div>

        {/* --- Identity ---------------------------------------------------- */}
        {/* Every rectangle on this page is edge-lit and every rim sweeps. The
            hierarchy comes from intensity and speed instead: this card is the
            brightest and quickest, the cards below are dimmer and slower, so
            the eye lands here first without anything having to sit still. */}
        <motion.div variants={staggerItem} className="mt-6">
          <EdgeLitCard
            radius="3xl"
            intensity={0.5}
            speed={13}
            innerClassName="p-8 text-center"
          >
            <div className="flex justify-center">
              <AvatarUpload />
            </div>

            {initialLoad ? (
              <div className="mt-5 flex flex-col items-center gap-2.5">
                <Skeleton height="1.6rem" width="52%" rounded="md" />
                <Skeleton height="0.85rem" width="34%" rounded="sm" />
                <Skeleton className="mt-1" height="0.75rem" width="72%" rounded="sm" />
              </div>
            ) : (
              <>
                <h1 className="mt-4 text-2xl font-bold text-white">
                  {fields.displayName || "New User"}
                </h1>
                <p style={{ color: "var(--theme-accent-purple)" }}>
                  @{fields.username || "username"}
                </p>
                <p className="mt-2 text-sm theme-text-muted">
                  {fields.bio || "Just here for the honest whispers ✨"}
                </p>
              </>
            )}
          </EdgeLitCard>
        </motion.div>

        {/* --- Editable fields --------------------------------------------- */}
        <div className="mt-4 space-y-4">
          <FieldCard variants={staggerItem} icon={User} label="Display Name">
            {initialLoad ? (
              <Skeleton className="mt-2.5" height="1.5rem" width="60%" rounded="md" />
            ) : (
              <input
                value={fields.displayName}
                onChange={(event) => update("displayName", event.target.value)}
                placeholder="Your name"
                maxLength={50}
                className="mt-2 w-full bg-transparent text-lg font-semibold text-white outline-none"
              />
            )}
          </FieldCard>

          <FieldCard
            variants={staggerItem}
            icon={AtSign}
            label="Username"
            error={usernameError}
          >
            {initialLoad ? (
              <Skeleton className="mt-2.5" height="1.5rem" width="70%" rounded="md" />
            ) : (
              <div className="mt-2 flex min-w-0 items-center text-lg">
                <span className="shrink-0 theme-text-subtle">whisper.app/u/</span>
                <input
                  value={fields.username}
                  onChange={(event) =>
                    update(
                      "username",
                      event.target.value
                        .replace(/[^a-zA-Z0-9_.]/g, "")
                        .toLowerCase()
                    )
                  }
                  placeholder="username"
                  maxLength={24}
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  aria-invalid={Boolean(usernameError) || undefined}
                  className="min-w-0 flex-1 bg-transparent font-semibold text-white outline-none"
                />
              </div>
            )}
          </FieldCard>

          <FieldCard variants={staggerItem} icon={Sparkles} label="Bio">
            {initialLoad ? (
              <SkeletonText className="mt-3" lines={2} />
            ) : (
              <>
                <textarea
                  {...PROSE_INPUT_PROPS}
                  value={fields.bio}
                  onChange={(event) =>
                    update("bio", event.target.value.slice(0, BIO_LIMIT))
                  }
                  placeholder="Tell people a little about yourself..."
                  rows={3}
                  className="mt-2 w-full resize-none bg-transparent text-white outline-none"
                />
                <div
                  className="text-right text-xs tabular-nums transition-colors"
                  style={{
                    color:
                      bioRemaining <= 15
                        ? "var(--theme-warning)"
                        : "var(--theme-text-subtle)",
                  }}
                >
                  {fields.bio.length}/{BIO_LIMIT}
                </div>
              </>
            )}
          </FieldCard>

          <motion.div variants={staggerItem}>
            <Button
              onClick={saveProfile}
              disabled={!canSave}
              loading={saving}
              size="lg"
              fullWidth
              icon={<Save size={18} />}
            >
              {dirty ? "Save changes" : "Saved"}
            </Button>
          </motion.div>
        </div>

        {/* --- Account ----------------------------------------------------- */}
        <motion.div variants={staggerItem} className="mt-8">
          <p className="mb-3 text-xs font-bold uppercase tracking-widest theme-text-muted">
            Account
          </p>

          <EdgeLitCard
            radius="2xl"
            intensity={0.45}
            speed={16}
            innerClassName="overflow-hidden"
          >
            <div className="divide-y" style={{ borderColor: "var(--hairline)" }}>
              {ACCOUNT_LINKS.map(({ href, icon: Icon, label, detail }) => (
                <Link
                  key={href}
                  href={href}
                  className="settings-row flex items-center gap-4 p-4"
                >
                  <span
                    className="grid h-9 w-9 flex-none place-items-center rounded-full"
                    style={{
                      background:
                        "color-mix(in srgb, var(--theme-accent-purple) 15%, transparent)",
                      color: "var(--theme-accent-purple)",
                    }}
                  >
                    <Icon size={18} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold text-white">
                      {label}
                    </span>
                    <span className="block truncate text-xs theme-text-muted">
                      {typeof detail === "function"
                        ? detail({ themeName: theme.name })
                        : detail}
                    </span>
                  </span>
                  <ChevronRight
                    size={16}
                    className="settings-chevron flex-none theme-text-subtle"
                  />
                </Link>
              ))}
            </div>
          </EdgeLitCard>
        </motion.div>

        {/* The destructive action gets no rim. Edge lighting reads as "look
            here"; pointing it at Logout would be the wrong emphasis. */}
        <motion.div variants={staggerItem} className="mt-6">
          <LogoutButton />
        </motion.div>
      </motion.div>

      <BottomNavigation />

      {/* Unsaved-changes hint, pinned above the tab bar. */}
      <motion.div
        initial={false}
        animate={{ opacity: dirty ? 1 : 0, y: dirty || reduced ? 0 : 12 }}
        transition={tween.base}
        aria-hidden={!dirty}
        className="pointer-events-none fixed inset-x-0 bottom-24 z-30 flex justify-center px-4"
      >
        <span
          className="rounded-full px-3.5 py-1.5 text-xs font-semibold"
          style={{
            background: "var(--theme-glass-strong)",
            border: "1px solid var(--theme-glass-border)",
            backdropFilter: "blur(18px)",
            WebkitBackdropFilter: "blur(18px)",
            color: "var(--theme-text-muted)",
            boxShadow: "var(--elev-3)",
          }}
        >
          Unsaved changes
        </span>
      </motion.div>
    </main>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * One labelled editable row.
 *
 * Extracted because the page wrote this shape out three times and the copies
 * had already drifted — different label colours, one missing its counter.
 */
function FieldCard({
  icon: Icon,
  label,
  error,
  children,
  variants,
}: {
  icon: LucideIcon;
  label: string;
  error?: string | null;
  children: React.ReactNode;
  variants: typeof staggerItem;
}) {
  return (
    <motion.div variants={variants}>
      <EdgeLitCard
        radius="2xl"
        intensity={error ? 0.7 : 0.45}
        speed={16}
        innerClassName="p-4"
      >
        <label className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-widest theme-text-muted">
          <Icon size={12} />
          {label}
        </label>

        {children}

        {error && (
          <motion.p
            initial={{ opacity: 0, y: -3 }}
            animate={{ opacity: 1, y: 0 }}
            transition={tween.fast}
            className="mt-1.5 text-xs font-medium"
            style={{ color: "var(--theme-error)" }}
          >
            {error}
          </motion.p>
        )}
      </EdgeLitCard>
    </motion.div>
  );
}
