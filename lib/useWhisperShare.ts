"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { useToast } from "@/components/ToastProvider";
import { supabase } from "@/lib/supabase/client";
import { getCachedSession } from "@/lib/supabase/session";
import { HAPTIC, vibrate } from "@/lib/haptics";

/**
 * The one place a Whisper link gets shared.
 *
 * Daily Whisper, Whisper Games, the dashboard link card and every future prompt
 * surface all want the same three things: the user's link, a share sheet that
 * carries a prompt with it, and a clipboard fallback. Written once here because
 * the fiddly parts are easy to get subtly wrong in each copy — the newline before
 * the URL, telling a cancelled share apart from a failed one, and the fact that
 * `navigator.clipboard` can reject outright.
 *
 * WHY THE PROMPT AND THE LINK TRAVEL TOGETHER
 *
 * A bare Whisper link asks nothing, so it gets scrolled past. The same link
 * under "What's my biggest red flag?" gets answered. The prompt is not
 * decoration around the share — it is the reason the share works, so this hook
 * has no way to share a link without one.
 */

/** How a share attempt ended, for callers that want to react differently. */
export type ShareOutcome = "shared" | "copied" | "cancelled" | "no-link" | "failed";

export function useWhisperShare() {
  const { showToast } = useToast();
  const [link, setLink] = useState("");
  const [username, setUsername] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const session = await getCachedSession();
      if (cancelled) return;

      if (!session) {
        setLoading(false);
        return;
      }

      const { data } = await supabase
        .from("profiles")
        .select("username")
        .eq("id", session.user.id)
        .maybeSingle();

      if (cancelled) return;

      /* `window.location.origin` rather than a hardcoded domain: this has to be
         right on the Vercel deployment, on a preview URL, and inside the
         Capacitor WebView, which loads the live origin. */
      if (data?.username) {
        setLink(`${window.location.origin}/u/${data.username}`);
        /* Kept alongside the link because the share card prints the handle, not
           the URL — a full link set at story-card size wraps across three lines
           and reads as a paste, where "@name" reads as an invitation. */
        setUsername(data.username);
      }
      setLoading(false);
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * The message body.
   *
   * The URL sits on its own line because WhatsApp, Instagram and X all linkify a
   * trailing URL and leave the text before it alone — inline, the question and
   * the link fight and one of them loses.
   */
  const composeMessage = useCallback(
    (prompt: string) => `${prompt}\n\nTell me anonymously 👇\n${link}`,
    [link]
  );

  const copyText = useCallback(
    async (text: string, message: string): Promise<boolean> => {
      try {
        await navigator.clipboard.writeText(text);
        vibrate(HAPTIC.success);
        showToast(message);
        return true;
      } catch {
        /* Permission-gated, and refused outright by some in-app browsers. Saying
           so beats a button that appears to do nothing. */
        showToast("Couldn't copy — long-press the text to copy it manually.");
        return false;
      }
    },
    [showToast]
  );

  /**
   * Share a prompt along with the user's link.
   *
   * Falls back to the clipboard only when there is no share sheet at all. A
   * *cancelled* sheet does not fall through — the user closed it on purpose, and
   * silently copying instead would be doing something they just declined.
   */
  const sharePrompt = useCallback(
    async (prompt: string): Promise<ShareOutcome> => {
      if (!link) {
        showToast("Set a username on your profile to start sharing your Whisper.");
        return "no-link";
      }

      const text = composeMessage(prompt);

      if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
        try {
          await navigator.share({ title: "Whisper", text });
          vibrate(HAPTIC.success);
          return "shared";
        } catch {
          return "cancelled";
        }
      }

      return (await copyText(text, "Prompt and link copied ✓")) ? "copied" : "failed";
    },
    [link, composeMessage, copyText, showToast]
  );

  /** Copy just the prompt, for pasting into a caption the user is writing. */
  const copyPrompt = useCallback(
    (prompt: string) => copyText(prompt, "Prompt copied ✓"),
    [copyText]
  );

  /** Copy the link on its own — the dashboard's Copy button. */
  const copyLink = useCallback(() => {
    if (!link) {
      showToast("Set a username on your profile to start sharing your Whisper.");
      return Promise.resolve(false);
    }
    return copyText(link, "Whisper link copied 🔗");
  }, [link, copyText, showToast]);

  return useMemo(
    () => ({ link, username, loading, ready: Boolean(link), sharePrompt, copyPrompt, copyLink, composeMessage }),
    [link, username, loading, sharePrompt, copyPrompt, copyLink, composeMessage]
  );
}

export default useWhisperShare;
