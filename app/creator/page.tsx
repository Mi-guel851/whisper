"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import {
  Eye,
  Image as ImageIcon,
  Loader2,
  Megaphone,
  PenLine,
  Send,
  ShieldOff,
  Trash2,
  X,
} from "lucide-react";

import BackButton from "@/components/BackButton";
import BottomNavigation from "@/components/BottomNavigation";
import GlassPanel from "@/components/GlassPanel";
import EmptyState from "@/components/ui/EmptyState";
import FeedAvatar from "@/components/feed/FeedAvatar";
import FeedPostCard from "@/components/feed/FeedPostCard";
import OfficialBadge from "@/components/feed/OfficialBadge";
import type { FeedController } from "@/components/feed/types";
import { useToast } from "@/components/ToastProvider";
import { supabase } from "@/lib/supabase/client";
import { CREATOR_ROLE, OFFICIAL_IDENTITY } from "@/lib/creator";
import { useCreatorAccess } from "@/lib/useCreatorAccess";
import { stripLinks, timeAgo, type FeedPost, type FeedPostNode } from "@/lib/feed";
import { ImagePrepError, prepareFeedImage, type PreparedFeedImage } from "@/lib/imagePreview";
import {
  CLOUDINARY_FOLDERS,
  CloudinaryUploadError,
  discardCloudinaryUpload,
  uploadToCloudinary,
} from "@/lib/cloudinary";
import { PROSE_INPUT_PROPS } from "@/lib/textEntry";
import { requireOnline } from "@/lib/offline";
import { useSafeReducedMotion } from "@/lib/useSafeReducedMotion";
import { tween } from "@/lib/motion";
import { vibrate, HAPTIC } from "@/lib/haptics";

/**
 * The Official Whisper Creator dashboard.
 *
 * WHO SEES THIS
 *
 * The page asks the database whether the signed-in account is a creator
 * (`useCreatorAccess` → `is_whisper_creator()`), and renders the tools only on
 * a `true`. Everyone else — signed out, signed in as a normal user, or someone
 * who typed the URL — gets the access-denied state below. That gate is a
 * courtesy for the UI; the real enforcement is in /api/creator/post and in the
 * `public_feed_posts` trigger + RLS, which re-verify on every write regardless
 * of what this page decided.
 *
 * WHAT IT DOES
 *
 * Write → (optional photo) → Preview → Publish, or Discard. The preview renders
 * the actual `FeedPostCard` with a synthetic row carrying the creator role, so
 * what the creator sees is pixel-for-pixel what the feed will draw. The synthetic
 * row never leaves this page: publishing sends only the text and the photo, and
 * the server decides the role.
 */

const MAX_BODY = 500;
const EMPTY_MAP: Record<string, never> = {};

export default function CreatorPage() {
  const { showToast } = useToast();
  const reducedMotion = useSafeReducedMotion();
  const { isCreator, userId, unavailable } = useCreatorAccess();

  const [body, setBody] = useState("");
  const [image, setImage] = useState<PreparedFeedImage | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [recent, setRecent] = useState<FeedPost[]>([]);

  const fileRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const trimmed = body.trim();
  const canPublish = trimmed.length > 0 && !publishing && !preparing;

  /* Previously published announcements by this creator, for context. Read
     straight from the table under RLS (select is open on live posts). */
  useEffect(() => {
    if (isCreator !== true || !userId) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("public_feed_posts")
        .select("id,author_id,body,whisper_link,created_at,expires_at,parent_post_id,view_count,image_preview,author_role")
        .eq("author_id", userId)
        .eq("author_role", CREATOR_ROLE)
        .is("parent_post_id", null)
        .gt("expires_at", new Date().toISOString())
        .order("created_at", { ascending: false })
        .limit(5);
      if (!cancelled && data) {
        setRecent(
          (data as FeedPost[]).map((row) => ({ ...row, has_image: Boolean(row.image_preview) }))
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isCreator, userId]);

  useEffect(() => {
    return () => {
      if (imageUrl) URL.revokeObjectURL(imageUrl);
    };
  }, [imageUrl]);

  const clearImage = useCallback(() => {
    setImage(null);
    setImageUrl((current) => {
      if (current) URL.revokeObjectURL(current);
      return null;
    });
    if (fileRef.current) fileRef.current.value = "";
  }, []);

  const pickImage = useCallback(
    async (file: File | undefined) => {
      if (!file) return;
      setPreparing(true);
      try {
        const prepared = await prepareFeedImage(file);
        clearImage();
        setImage(prepared);
        setImageUrl(URL.createObjectURL(prepared.upload));
        vibrate(HAPTIC.tap);
      } catch (error) {
        showToast(error instanceof ImagePrepError ? error.message : "Couldn't read that image.");
      } finally {
        setPreparing(false);
      }
    },
    [clearImage, showToast]
  );

  const discard = useCallback(() => {
    setBody("");
    clearImage();
    setPreviewing(false);
    textareaRef.current?.focus();
  }, [clearImage]);

  const publish = useCallback(async () => {
    if (!canPublish) return;
    if (image && !image.preview) {
      showToast("Couldn't build a preview for that photo. Try a different one.");
      return;
    }
    if (!requireOnline(showToast, "Publishing")) return;

    setPublishing(true);
    let uploadedUrl: string | null = null;
    let accessToken: string | null = null;

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        showToast("Login required");
        return;
      }
      accessToken = session.access_token;

      if (image) {
        try {
          const uploaded = await uploadToCloudinary(
            image.upload,
            `${CLOUDINARY_FOLDERS.feedPhotos}/${session.user.id}`,
            `official.${image.extension}`
          );
          uploadedUrl = uploaded.url;
        } catch (error) {
          showToast(
            error instanceof CloudinaryUploadError ? error.message : "Couldn't upload that photo."
          );
          return;
        }
      }

      /* Only the content goes over the wire. There is no role, flag or identity
         field to send — the server derives all of that from the session. */
      const res = await fetch("/api/creator/post", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          message: stripLinks(trimmed).slice(0, MAX_BODY) || trimmed.slice(0, MAX_BODY),
          imagePath: uploadedUrl,
          imagePreview: image?.preview ?? null,
        }),
      });
      const json = await res.json().catch(() => ({} as { error?: string; post?: FeedPost }));

      if (!res.ok) {
        showToast(json.error || "Couldn't publish that.");
        await discardCloudinaryUpload(uploadedUrl, accessToken);
        return;
      }

      if (json.post) {
        setRecent((current) => [json.post as FeedPost, ...current].slice(0, 5));
      }
      vibrate(HAPTIC.success);
      showToast("Post live", { variant: "subtle" });
      setBody("");
      clearImage();
      setPreviewing(false);
    } catch (error) {
      console.error(error);
      showToast("Network error");
      await discardCloudinaryUpload(uploadedUrl, accessToken);
    } finally {
      setPublishing(false);
    }
  }, [canPublish, image, trimmed, clearImage, showToast]);

  /* The preview row. Carries the creator role so the card draws the official
     identity — and it exists only in this component's memory. */
  const previewNode = useMemo<FeedPostNode>(() => {
    const now = new Date();
    return {
      id: "preview",
      author_id: userId,
      author_role: CREATOR_ROLE,
      body: trimmed || "Your announcement will appear here.",
      whisper_link: "",
      created_at: now.toISOString(),
      expires_at: new Date(now.getTime() + 24 * 3600 * 1000).toISOString(),
      parent_post_id: null,
      view_count: 0,
      has_image: Boolean(image),
      image_preview: image?.preview ?? null,
      like_count: 0,
      reply_count: 0,
      viewer_liked: false,
      children: [],
    };
  }, [trimmed, image, userId]);

  const inertController = useMemo<FeedController>(
    () => ({
      myId: userId,
      replyCost: 0,
      reducedMotion,
      likeCount: EMPTY_MAP,
      liked: EMPTY_MAP,
      replyOpen: EMPTY_MAP,
      replyText: EMPTY_MAP,
      replySending: EMPTY_MAP,
      expanded: EMPTY_MAP,
      threadLoading: EMPTY_MAP,
      pollCounts: EMPTY_MAP,
      pollChoice: EMPTY_MAP,
      pollPending: EMPTY_MAP,
      imageState: EMPTY_MAP,
      onToggleLike: () => {},
      onToggleReplyBox: () => {},
      onReplyTextChange: () => {},
      onRequestSend: () => {},
      onToggleThread: () => {},
      onRequestDelete: () => {},
      onShare: () => {},
      onVote: () => {},
      onOpenImage: () => {},
      onOpenMenu: () => {},
    }),
    [userId, reducedMotion]
  );

  /* ------------------------------------------------------------------
     Gates
     ------------------------------------------------------------------ */

  if (isCreator === null) {
    return (
      <main className="min-h-screen theme-bg-gradient pb-28">
        <div className="creator-shell creator-denied">
          <Loader2 className="animate-spin" size={22} aria-label="Checking access" />
        </div>
      </main>
    );
  }

  if (isCreator !== true) {
    return (
      <main className="min-h-screen theme-bg-gradient pb-28">
        <div className="creator-shell">
          <header className="creator-head">
            <BackButton />
          </header>
          <div className="creator-denied">
            <EmptyState
              icon={<ShieldOff size={26} />}
              title={userId ? "Access denied" : "Sign in required"}
              description={
                unavailable
                  ? "Official posts aren't set up on this server yet."
                  : userId
                    ? "This area is reserved for official Whisper creators. Your account doesn't have creator access."
                    : "Sign in with an official Whisper creator account to continue."
              }
              action={
                userId
                  ? { label: "Back to the feed", href: "/public-feed" }
                  : { label: "Sign in", href: "/login" }
              }
            />
          </div>
        </div>
        <BottomNavigation />
      </main>
    );
  }

  /* ------------------------------------------------------------------
     Dashboard
     ------------------------------------------------------------------ */

  return (
    <main className="min-h-screen theme-bg-gradient pb-28">
      <div className="creator-shell">
        <header className="creator-head">
          <BackButton />
          <div className="creator-identity">
            <FeedAvatar authorId={userId} size={52} official />
            <div className="min-w-0">
              <h1 className="creator-identity-name">
                {OFFICIAL_IDENTITY.name}
                <OfficialBadge size="md" />
              </h1>
              <p className="creator-identity-sub">
                Creator dashboard · announcements publish to the public feed as Whisper.
              </p>
            </div>
          </div>
        </header>

        <GlassPanel className="creator-panel" strong>
          <AnimatePresence mode="wait" initial={false}>
            {previewing ? (
              <motion.section
                key="preview"
                initial={reducedMotion ? false : { opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reducedMotion ? undefined : { opacity: 0, y: -6 }}
                transition={tween.base}
                aria-label="Preview"
              >
                <div className="creator-preview-title">
                  <span className="creator-label !mb-0">Preview</span>
                  <span className="text-xs" style={{ color: "var(--theme-text-muted)" }}>
                    Live for 24 hours · {timeAgo(previewNode.created_at)}
                  </span>
                </div>

                <div className="creator-preview">
                  <FeedPostCard node={previewNode} controller={inertController} depth={0} />
                  {imageUrl && (
                    <div className="creator-preview-image mx-3">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={imageUrl} alt="Attached photo" />
                    </div>
                  )}
                </div>

                <div className="creator-actions">
                  <button
                    type="button"
                    className="creator-btn creator-btn-secondary"
                    onClick={() => setPreviewing(false)}
                    disabled={publishing}
                  >
                    <PenLine size={16} aria-hidden />
                    Edit
                  </button>
                  <button
                    type="button"
                    className="creator-btn creator-btn-primary"
                    onClick={() => void publish()}
                    disabled={!canPublish}
                  >
                    {publishing ? (
                      <Loader2 size={16} className="animate-spin" aria-hidden />
                    ) : (
                      <Send size={16} aria-hidden />
                    )}
                    {publishing ? "Publishing…" : "Publish"}
                  </button>
                </div>
              </motion.section>
            ) : (
              <motion.section
                key="compose"
                initial={reducedMotion ? false : { opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reducedMotion ? undefined : { opacity: 0, y: -6 }}
                transition={tween.base}
                aria-label="Compose"
              >
                <label htmlFor="creator-body" className="creator-label">
                  <Megaphone size={12} className="mr-1 inline-block align-[-1px]" aria-hidden />
                  Official update
                </label>
                <textarea
                  id="creator-body"
                  ref={textareaRef}
                  {...PROSE_INPUT_PROPS}
                  className="creator-textarea"
                  placeholder="We've got something exciting coming…"
                  value={body}
                  maxLength={MAX_BODY}
                  onChange={(event) => setBody(event.target.value)}
                  disabled={publishing}
                />

                <div className="creator-meta">
                  <div className="flex items-center gap-2">
                    <input
                      ref={fileRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(event) => void pickImage(event.target.files?.[0])}
                    />
                    <button
                      type="button"
                      className="creator-tool"
                      onClick={() => {
                        vibrate(HAPTIC.tap);
                        fileRef.current?.click();
                      }}
                      disabled={preparing || publishing}
                    >
                      {preparing ? (
                        <Loader2 size={15} className="animate-spin" aria-hidden />
                      ) : (
                        <ImageIcon size={15} aria-hidden />
                      )}
                      {image ? "Change photo" : "Add photo"}
                    </button>
                  </div>
                  <span className="tabular-nums">
                    {trimmed.length}/{MAX_BODY}
                  </span>
                </div>

                {imageUrl && (
                  <div className="creator-image">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={imageUrl} alt="Attached photo" />
                    <button
                      type="button"
                      className="creator-image-remove"
                      onClick={clearImage}
                      aria-label="Remove photo"
                    >
                      <X size={16} />
                    </button>
                  </div>
                )}

                <div className="creator-actions">
                  <button
                    type="button"
                    className="creator-btn creator-btn-secondary"
                    onClick={discard}
                    disabled={publishing || (!trimmed && !image)}
                  >
                    <Trash2 size={16} aria-hidden />
                    Discard
                  </button>
                  <button
                    type="button"
                    className="creator-btn creator-btn-secondary"
                    onClick={() => {
                      vibrate(HAPTIC.tap);
                      setPreviewing(true);
                    }}
                    disabled={!trimmed || publishing}
                  >
                    <Eye size={16} aria-hidden />
                    Preview
                  </button>
                  <button
                    type="button"
                    className="creator-btn creator-btn-primary"
                    onClick={() => void publish()}
                    disabled={!canPublish}
                  >
                    {publishing ? (
                      <Loader2 size={16} className="animate-spin" aria-hidden />
                    ) : (
                      <Send size={16} aria-hidden />
                    )}
                    Publish
                  </button>
                </div>
              </motion.section>
            )}
          </AnimatePresence>
        </GlassPanel>

        {recent.length > 0 && (
          <section className="creator-recent" aria-label="Recent official posts">
            <span className="creator-label">Live announcements</span>
            <GlassPanel className="px-3 py-1">
              {recent.map((post) => (
                <FeedPostCard
                  key={post.id}
                  node={{ ...post, children: [] }}
                  controller={inertController}
                  depth={0}
                />
              ))}
            </GlassPanel>
            <p className="mt-2 text-center text-xs" style={{ color: "var(--theme-text-muted)" }}>
              Manage replies, likes and deletion from the{" "}
              <Link href="/public-feed" className="font-bold underline">
                public feed
              </Link>
              .
            </p>
          </section>
        )}
      </div>
      <BottomNavigation />
    </main>
  );
}
