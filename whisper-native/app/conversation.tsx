import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { BlurView } from "expo-blur";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { LinearGradient } from "expo-linear-gradient";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Avatar } from "@/components/Avatar";
import { IconButton } from "@/components/GradientButton";
import { LoadingScreen } from "@/components/Screen";
import { ConfirmSheet, Sheet, SheetRow } from "@/components/Sheet";
import { VoiceNotePlayer } from "@/components/VoiceNotePlayer";
import { VoiceRecorderPanel } from "@/components/VoiceRecorderPanel";
import { refreshBadges } from "@/lib/badges";
import { SEND_IMAGE_COST, SEND_VOICE_COST, UNLOCK_CHAT_COST, fetchWallet } from "@/lib/coins";
import {
  areFriends,
  claimAudio,
  claimPhoto,
  fetchConversation,
  fetchMessages,
  isChatUnlocked,
  markDelivered,
  markRead,
  otherParticipant,
  sendMessage,
  sendPhotoMessage,
  sendVoiceNote,
  fetchPinnedMessageIds,
  pinMessage,
  PIN_DURATIONS,
  stampConversationRead,
  sweepExpiredPins,
  unpinMessage,
  unlockChat,
} from "@/lib/dms";
import { safeErrorMessage } from "@/lib/errors";
import { clockTime, dayDivider } from "@/lib/format";
import { vibrate } from "@/lib/haptics";
import { useAnonName } from "@/lib/identity";
import { useSession } from "@/lib/session";
import { useToast } from "@/lib/toast";
import { COLORS, GLASS, GRADIENT_COLORS, RADIUS } from "@/lib/theme";
import { supabase } from "@/lib/supabase";
import { useVoiceRecorder } from "@/lib/useVoiceRecorder";
import type { ConversationRow, DirectMessage, VoiceRecording } from "@/lib/types";

/** One rendered line: a message, or a day divider. */
type Row =
  | { kind: "message"; id: string; message: DirectMessage }
  | { kind: "divider"; id: string; label: string };

/** The one-line preview the pin bar and the duration sheet show. */
function messagePreview(message: DirectMessage): string {
  if (message.content?.trim()) return message.content.trim();
  if (message.audio_path) return "Voice note";
  if (message.image_path || message.image_viewed_at) return "Photo";
  return "Message";
}

/**
 * One conversation.
 *
 * A port of `app/chat/[conversationId]/page.tsx`, and the most intricate screen
 * in the app because three separate payment gates and one view-once rule all
 * live in it:
 *
 *   unlock the thread   40 coins, one time, unless you are friends
 *   send a photo        10 coins
 *   send a voice note    5 coins
 *
 * Every one of those is enforced by the database — `unlock_chat_with_coins`,
 * `spend_coins_for_image`, `send_voice_note` — and this screen only reflects
 * what the server decided. A failed spend aborts the send and cleans up after
 * itself; the client never gets to send a paid message for free.
 *
 * VIEW-ONCE MEDIA
 *
 * A photo or a voice note is claimed exactly once, through `/api/photos/view`
 * and `/api/audio/view`, and the claim stamps `image_viewed_at` /
 * `audio_viewed_at` and destroys the asset in the same request that returns the
 * bytes. The bubble keeps its place afterwards, marked viewed — a message that
 * vanishes is a conversation with a hole in it.
 *
 * READ RECEIPTS
 *
 * `readColumnFor` decides which of `user_a_last_read_at` / `user_b_last_read_at`
 * is mine: the schema stores the two directions in columns rather than rows, so
 * "mark read" is one update and both sides can see it. Incoming messages are
 * stamped delivered on arrival, read once the screen has them.
 */
export default function Conversation() {
  const params = useLocalSearchParams() as { conversationId?: string; otherId?: string };
  const conversationId = typeof params.conversationId === "string" ? params.conversationId : "";
  const otherIdParam = typeof params.otherId === "string" ? params.otherId : "";

  const insets = useSafeAreaInsets();
  const { userId, session } = useSession();
  const { showToast } = useToast();

  const [conversation, setConversation] = useState<ConversationRow | null>(null);
  const [messages, setMessages] = useState<DirectMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [draft, setDraft] = useState("");
  const [locked, setLocked] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const [balance, setBalance] = useState<number | null>(null);
  const [claimedPhotos, setClaimedPhotos] = useState<Record<string, string>>({});
  const [claimedAudio, setClaimedAudio] = useState<Record<string, string>>({});
  const [claiming, setClaiming] = useState<Record<string, true>>({});
  const [pendingVoice, setPendingVoice] = useState<VoiceRecording | null>(null);
  const [otherTyping, setOtherTyping] = useState(false);
  const [menuMessage, setMenuMessage] = useState<DirectMessage | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DirectMessage | null>(null);
  /* Pins: which messages in this thread are pinned, the message awaiting a
     duration pick, and where the header bar's cycle is. The bar advances only
     when there is more than one pin — a single pin that cycles is a glitch,
     not a feature. */
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(new Set());
  const [pinDurationFor, setPinDurationFor] = useState<DirectMessage | null>(null);
  const [pinCursor, setPinCursor] = useState(0);

  const listRef = useRef<FlatList<Row>>(null);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const recorder = useVoiceRecorder();

  /* WHOSE CHAT THIS IS

     The route carries an `otherId` when we know it — the inbox does — but a
     notification tap only knows the conversation id, and a deep link may know
     neither. The conversation row has both participants, so the other side is
     derived from it whenever it is loaded, and the parameter is only a
     placeholder until then. Everything downstream (the name, the friendship
     check) reads the derived value, never the parameter. */
  const otherId = useMemo(
    () => (conversation && userId ? otherParticipant(conversation, userId) : otherIdParam),
    [conversation, otherIdParam, userId]
  );

  const name = useAnonName(otherId);

  /* -----------------------------------------------------------------------
     Load
     -------------------------------------------------------------------- */

  const load = useCallback(async () => {
    if (!userId || !conversationId) return;

    const [row, transcript, friends, unlocked, wallet] = await Promise.all([
      fetchConversation(conversationId),
      fetchMessages(conversationId),
      areFriends(userId, otherId),
      isChatUnlocked(conversationId, userId),
      fetchWallet(userId),
    ]);

    setConversation(row);
    setMessages(transcript);
    setLocked(!unlocked && !friends);
    setBalance(wallet?.balance ?? 0);
    setLoading(false);

    /* The lazy sweep the schema documents: expired pins are cleared when a
       thread is opened rather than by a cron nobody watches. Fire and forget —
       housekeeping must never hold up the transcript. */
    void sweepExpiredPins(conversationId).catch(() => {});
    void fetchPinnedMessageIds(conversationId).then((ids) => setPinnedIds(ids));

    const incomingIds = transcript
      .filter((message) => message.sender_id !== userId && !message.delivered_at)
      .map((message) => message.id);

    if (incomingIds.length > 0) void markDelivered(incomingIds);
  }, [conversationId, otherId, userId]);

  useEffect(() => {
    void load();
  }, [load]);

  /* Read stamps: the per-message column and the conversation's own, so a tick
     means the same thing whether it is asked of a message or of the thread. */
  const stampRead = useCallback(async () => {
    if (!userId || !conversation) return;

    const unread = messages
      .filter((message) => message.sender_id !== userId && !message.read_at)
      .map((message) => message.id);

    if (unread.length > 0) void markRead(unread);
    void stampConversationRead(conversationId, userId, conversation);
    void refreshBadges(userId);
  }, [conversation, conversationId, messages, userId]);

  useEffect(() => {
    if (loading) return;
    void stampRead();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, messages.length]);

  /* Realtime: new messages, the read/delivered edits the other side makes, and
     typing. Typing is presence rather than a row — it should evaporate when
     somebody closes the app, and a database row cannot do that. */
  useEffect(() => {
    if (!userId || !conversationId) return;

    const channel = supabase
      .channel(`chat-${conversationId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "direct_messages",
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          if (payload.eventType === "INSERT") {
            const incoming = payload.new as DirectMessage;
            setMessages((current) =>
              current.some((message) => message.id === incoming.id) ? current : [...current, incoming]
            );

            if (incoming.sender_id !== userId) {
              vibrate("tap");
              void markDelivered([incoming.id]);
              void markRead([incoming.id]);
            }
            return;
          }

          if (payload.eventType === "UPDATE") {
            const updated = payload.new as DirectMessage;
            setMessages((current) =>
              current.map((message) => (message.id === updated.id ? { ...message, ...updated } : message))
            );
            return;
          }

          const removed = payload.old as { id?: string };
          if (removed?.id) setMessages((current) => current.filter((message) => message.id !== removed.id));
        }
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "pinned_messages", filter: `conversation_id=eq.${conversationId}` },
        (payload) => {
          const row = payload.new as { message_id: string };
          vibrate("tap");
          setPinnedIds((current) => new Set([...current, row.message_id]));
        }
      )
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "pinned_messages" }, (payload) => {
        const row = payload.old as { message_id?: string };
        if (!row?.message_id) return;
        setPinnedIds((current) => {
          const next = new Set(current);
          next.delete(row.message_id as string);
          return next;
        });
      })
      .on("presence", { event: "sync" }, () => {
        const state = channel.presenceState() as Record<string, { user_id?: string; typing?: boolean }[]>;
        const typing = Object.values(state)
          .flat()
          .some((entry) => entry.user_id === otherId && entry.typing);
        setOtherTyping(typing);
      })
      .subscribe();

    channelRef.current = channel;

    return () => {
      channelRef.current = null;
      void supabase.removeChannel(channel);
    };
  }, [conversationId, otherId, userId]);

  /* Announce typing on the same channel. Debounced on the way out — one
     presence update per burst of keystrokes, not one per character. */
  useEffect(() => {
    if (!userId) return;
    const channel = channelRef.current;
    if (!channel) return;

    void channel.track({ user_id: userId, typing: draft.trim().length > 0 }).catch(() => {});
    return () => {
      void channelRef.current?.track({ user_id: userId, typing: false }).catch(() => {});
    };
  }, [draft, userId]);

  /* -----------------------------------------------------------------------
     Sending
     -------------------------------------------------------------------- */

  const send = useCallback(async () => {
    const body = draft.trim();
    if (!body || !userId || sending || locked) return;

    setSending(true);
    setDraft("");
    vibrate("tap");

    const result = await sendMessage({ conversationId, senderId: userId, content: body });
    setSending(false);

    if (!result.ok) {
      setDraft(body);
      showToast(result.error, { variant: "error" });
      return;
    }

    /* The realtime insert will also deliver this row; the dedupe is by id, so
       adding it here means the message appears on the frame the user tapped
       rather than one round trip later. */
    setMessages((current) =>
      current.some((message) => message.id === result.message.id) ? current : [...current, result.message]
    );
  }, [conversationId, draft, locked, sending, showToast, userId]);

  const sendPhoto = useCallback(async () => {
    if (!userId || !session?.access_token || sending) return;

    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      showToast("Photo access is off. Turn it on in your settings to send a photo.", {
        variant: "warning",
      });
      return;
    }

    if (balance !== null && balance < SEND_IMAGE_COST) {
      showToast(`You need ${SEND_IMAGE_COST} coins to send a photo.`, { variant: "warning" });
      return;
    }

    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.85,
      allowsEditing: false,
    });

    if (picked.canceled || !picked.assets[0]) return;

    const asset = picked.assets[0];
    setSending(true);

    const result = await sendPhotoMessage({
      conversationId,
      senderId: userId,
      accessToken: session.access_token,
      image: {
        uri: asset.uri,
        mimeType: asset.mimeType ?? "image/jpeg",
        fileName: asset.fileName ?? `photo-${Date.now()}.jpg`,
      },
      caption: draft.trim() || null,
    });

    setSending(false);

    if (!result.ok) {
      showToast(result.error, { variant: "error" });
      return;
    }

    setDraft("");
    setMessages((current) => [...current, result.message]);
    vibrate("success");
    showToast(`Photo sent · ${SEND_IMAGE_COST} coins`, { variant: "subtle" });
    void fetchWallet(userId).then((wallet) => setBalance(wallet?.balance ?? 0));
  }, [balance, conversationId, draft, sending, session?.access_token, showToast, userId]);

  const sendVoice = useCallback(async () => {
    if (!pendingVoice || !userId || sending) return;

    setSending(true);
    const result = await sendVoiceNote({ conversationId, recording: pendingVoice });
    setSending(false);

    if (!result.ok) {
      showToast(result.error, { variant: "error" });
      return;
    }

    /* Voice notes are inserted by the RPC, so the row arrives through realtime
       rather than being returned. Clear the recording and let it land. */
    setPendingVoice(null);
    vibrate("success");
    showToast(`Voice note sent · ${SEND_VOICE_COST} coins`, { variant: "subtle" });
    void fetchWallet(userId).then((wallet) => setBalance(wallet?.balance ?? 0));
  }, [conversationId, pendingVoice, sending, showToast, userId]);

  /* -----------------------------------------------------------------------
     The 40-coin gate
     -------------------------------------------------------------------- */

  const unlock = useCallback(async () => {
    setUnlocking(true);
    try {
      await unlockChat(conversationId);
      setLocked(false);
      vibrate("success");
      showToast("Conversation unlocked", { variant: "success" });
      if (userId) void fetchWallet(userId).then((wallet) => setBalance(wallet?.balance ?? 0));

      const transcript = await fetchMessages(conversationId);
      setMessages(transcript);
    } catch (cause) {
      showToast(safeErrorMessage(cause, "Couldn't unlock this conversation."), { variant: "error" });
    } finally {
      setUnlocking(false);
    }
  }, [conversationId, showToast, userId]);

  /* -----------------------------------------------------------------------
     View-once claims
     -------------------------------------------------------------------- */

  const openViewOnce = useCallback(
    async (message: DirectMessage) => {
      if (!session?.access_token || claiming[message.id]) return;

      setClaiming((current) => ({ ...current, [message.id]: true }));

      const result = message.audio_path
        ? await claimAudio(message, session.access_token)
        : await claimPhoto(message.id, session.access_token);

      setClaiming((current) => {
        const next = { ...current };
        delete next[message.id];
        return next;
      });

      if ("error" in result) {
        showToast(result.error, { variant: "error" });
        return;
      }

      if (message.audio_path) {
        setClaimedAudio((current) => ({ ...current, [message.id]: result.uri }));
        setMessages((current) =>
          current.map((row) =>
            row.id === message.id ? { ...row, audio_viewed_at: new Date().toISOString() } : row
          )
        );
      } else {
        setClaimedPhotos((current) => ({ ...current, [message.id]: result.uri }));
        setMessages((current) =>
          current.map((row) =>
            row.id === message.id ? { ...row, image_viewed_at: new Date().toISOString() } : row
          )
        );
      }

      vibrate("select");
    },
    [claiming, session?.access_token, showToast]
  );

  /* -----------------------------------------------------------------------
     Rows
     -------------------------------------------------------------------- */

  const rows = useMemo<Row[]>(() => {
    const output: Row[] = [];
    let lastDay = "";

    for (const message of messages) {
      const divider = dayDivider(message.created_at);
      if (divider && divider !== lastDay) {
        output.push({ kind: "divider", id: `divider-${divider}`, label: divider });
        lastDay = divider;
      }
      output.push({ kind: "message", id: message.id, message });
    }

    return output;
  }, [messages]);

  /* The pinned bar's data: pinned messages in transcript order, the one the
     bar is showing, and the cycle. Only live messages count — a pin on a
     deleted row would point at nothing. */
  const pinnedMessages = useMemo(
    () => messages.filter((message) => pinnedIds.has(message.id)),
    [messages, pinnedIds]
  );
  const activePin = pinnedMessages.length > 0 ? pinnedMessages[pinCursor % pinnedMessages.length] : null;

  const jumpToNextPin = useCallback(() => {
    vibrate("tap");
    if (pinnedMessages.length > 1) setPinCursor((cursor) => cursor + 1);
  }, [pinnedMessages.length]);

  const togglePin = useCallback(
    (message: DirectMessage) => {
      if (pinnedIds.has(message.id)) {
        void unpinMessage(conversationId, message.id).then((result) => {
          if (!result.ok) {
            showToast(result.error || "Couldn't unpin that message.", { variant: "error" });
            return;
          }
          setPinnedIds((current) => {
            const next = new Set(current);
            next.delete(message.id);
            return next;
          });
          showToast("Unpinned", { variant: "subtle" });
        });
        return;
      }
      /* No duration yet — the sheet asks how long, exactly as the web chat's
         own pin flow does before it writes the row. */
      setMenuMessage(null);
      setPinDurationFor(message);
    },
    [conversationId, pinnedIds, showToast]
  );

  const confirmPin = useCallback(
    (message: DirectMessage, durationHours: number | null) => {
      setPinDurationFor(null);
      if (!userId) return;
      void pinMessage(conversationId, message.id, userId, durationHours).then((result) => {
        if (!result.ok) {
          showToast(result.error || "Couldn't pin that message.", { variant: "error" });
          return;
        }
        setPinnedIds((current) => new Set([...current, message.id]));
        showToast(durationHours === null ? "Pinned" : `Pinned for ${PIN_DURATIONS.find((d) => d.hours === durationHours)?.label ?? "a while"}`, { variant: "subtle" });
      });
    },
    [conversationId, showToast, userId]
  );

  /* New messages land at the bottom, so the list stays pinned there. `inverted`
     is deliberately not used: the transcript is chronological, and a day divider
     only means anything in that direction. */
  useEffect(() => {
    if (rows.length === 0) return;
    const timer = setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 80);
    return () => clearTimeout(timer);
  }, [rows.length]);

  if (loading || !conversationId) return <LoadingScreen label={conversationId ? `Opening chat with ${name}` : "Opening chat"} />;

  return (
    <View style={styles.root}>
      <BlurView intensity={GLASS.blurIntensity} tint="dark" style={styles.header}>
        <View style={[styles.headerInner, { paddingTop: insets.top + 6 }]}>
          <IconButton
            icon="chevron-back"
            size={40}
            onPress={() => router.back()}
            accessibilityLabel="Go back"
          />

          <Pressable
            style={styles.headerWho}
            onPress={() => router.push({ pathname: "/u", params: { userId: otherId } })}
            accessibilityLabel={`Open ${name}'s profile`}
          >
            <Avatar authorId={otherId} size={36} />
            <View style={styles.headerText}>
              <Text style={styles.headerName} numberOfLines={1}>
                {name}
              </Text>
              <Text style={styles.headerStatus}>
                {otherTyping ? "typing…" : locked ? `Locked · ${UNLOCK_CHAT_COST} coins` : "Anonymous"}
              </Text>
            </View>
          </Pressable>

          <IconButton
            icon="person-outline"
            size={40}
            onPress={() => router.push({ pathname: "/u", params: { userId: otherId } })}
            accessibilityLabel="View profile"
          />
        </View>
      </BlurView>

      {/* The pinned bar — the web chat's bar under the header, cycling through
          every pin this thread holds. Tapping it advances; the crossed-out pin
          unpins the one on show. */}
      {activePin ? (
        <View style={styles.pinBar}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              pinnedMessages.length > 1 ? `Jump to pinned message, ${pinCursor % pinnedMessages.length + 1} of ${pinnedMessages.length}` : "Jump to pinned message"
            }
            onPress={jumpToNextPin}
            style={styles.pinBarMain}
          >
            <Ionicons name="pin" size={13} color={COLORS.warning} />
            <Text style={styles.pinBarText} numberOfLines={1}>
              {messagePreview(activePin)}
            </Text>
            {pinnedMessages.length > 1 ? (
              <Text style={styles.pinBarCount}>
                {(pinCursor % pinnedMessages.length) + 1}/{pinnedMessages.length}
              </Text>
            ) : null}
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Unpin this message"
            onPress={() => togglePin(activePin)}
            style={styles.pinBarUnpin}
            hitSlop={6}
          >
            <Ionicons name="close" size={15} color={COLORS.warning} />
          </Pressable>
        </View>
      ) : null}

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={0}
      >
        <FlatList
          ref={listRef}
          data={rows}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
          initialNumToRender={20}
          renderItem={({ item }) => {
            if (item.kind === "divider") return <DayDivider label={item.label} />;

            return (
              <MessageBubble
                message={item.message}
                mine={item.message.sender_id === userId}
                claimedPhotoUri={claimedPhotos[item.message.id]}
                claimedAudioUri={claimedAudio[item.message.id]}
                claiming={Boolean(claiming[item.message.id])}
                pinned={pinnedIds.has(item.message.id)}
                onClaim={() => void openViewOnce(item.message)}
                onLongPress={() => setMenuMessage(item.message)}
              />
            );
          }}
          ListHeaderComponent={
            locked ? (
              <LockedBanner
                cost={UNLOCK_CHAT_COST}
                balance={balance}
                busy={unlocking}
                onUnlock={() => void unlock()}
              />
            ) : (
              <View style={styles.intro}>
                <Avatar authorId={otherId} size={64} />
                <Text style={styles.introName}>{name}</Text>
                <Text style={styles.introText}>
                  You&apos;re chatting anonymously. Nothing here reveals who either of you is.
                </Text>
              </View>
            )
          }
        />

        {!locked && (
          <View style={[styles.composer, { paddingBottom: Math.max(insets.bottom, 10) }]}>
            <BlurView intensity={GLASS.blurIntensity} tint="dark" style={styles.composerInner}>
              {recorder.isRecording || pendingVoice ? (
                <VoiceRecorderPanel
                  recorder={recorder}
                  pending={pendingVoice}
                  sending={sending}
                  onSend={() => void sendVoice()}
                  onDiscard={() => {
                    setPendingVoice(null);
                    void recorder.cancel();
                  }}
                />
              ) : (
                <View style={styles.composerRow}>
                  <Pressable
                    onPress={() => void sendPhoto()}
                    style={styles.composerIcon}
                    disabled={sending}
                    accessibilityLabel={`Send a photo, ${SEND_IMAGE_COST} coins`}
                  >
                    <Ionicons name="image-outline" size={21} color={COLORS.muted} />
                  </Pressable>

                  <TextInput
                    value={draft}
                    onChangeText={setDraft}
                    placeholder="Message…"
                    placeholderTextColor={COLORS.subtle}
                    multiline
                    keyboardAppearance="dark"
                    style={styles.input}
                  />

                  {draft.trim().length > 0 ? (
                    <Pressable onPress={() => void send()} disabled={sending} accessibilityLabel="Send message">
                      <LinearGradient
                        colors={GRADIENT_COLORS}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 1 }}
                        style={styles.sendButton}
                      >
                        <Ionicons name="arrow-up" size={19} color="#0a0814" />
                      </LinearGradient>
                    </Pressable>
                  ) : (
                    <Pressable
                      onPress={() => {
                        vibrate("select");
                        void recorder.start();
                      }}
                      style={styles.micButton}
                      accessibilityLabel={`Record a voice note, ${SEND_VOICE_COST} coins`}
                    >
                      <Ionicons name="mic" size={20} color={COLORS.cyan} />
                    </Pressable>
                  )}
                </View>
              )}
            </BlurView>

            {recorder.error ? (
              <Pressable onPress={recorder.clearError}>
                <Text style={styles.recorderError}>{recorder.error}</Text>
              </Pressable>
            ) : null}

            {!recorder.isRecording && !pendingVoice && (
              <Text style={styles.composerHint}>
                Photo {SEND_IMAGE_COST} · Voice {SEND_VOICE_COST} coins — both play once
              </Text>
            )}
          </View>
        )}
      </KeyboardAvoidingView>

      <Sheet visible={Boolean(menuMessage)} onClose={() => setMenuMessage(null)} title="Message options">
        {menuMessage && (
          <View style={{ paddingBottom: 10 }}>
            <SheetRow
              icon="person-outline"
              label="View profile"
              onPress={() => {
                setMenuMessage(null);
                router.push({ pathname: "/u", params: { userId: otherId } });
              }}
            />
            {/* A pinned message un-pins from here; an unpinned one opens the
                duration sheet. The web hides the action entirely when the
                message is already pinned — showing the opposite action is the
                same honesty with one less dead row. */}
            <SheetRow
              icon={pinnedIds.has(menuMessage.id) ? "close-circle" : "pin-outline"}
              label={pinnedIds.has(menuMessage.id) ? "Unpin message" : "Pin message"}
              detail={
                pinnedIds.has(menuMessage.id)
                  ? undefined
                  : "Keeps it at the top of this chat for a while"
              }
              onPress={() => {
                const target = menuMessage;
                setMenuMessage(null);
                if (target) togglePin(target);
              }}
            />
            {menuMessage.sender_id === userId && (
              <SheetRow
                icon="trash-outline"
                label="Delete message"
                danger
                detail="Removes it for both of you"
                onPress={() => {
                  setDeleteTarget(menuMessage);
                  setMenuMessage(null);
                }}
              />
            )}
          </View>
        )}
      </Sheet>

      {/* The duration pick — the web chat's pin dialog, same four choices in
          the same order. */}
      <Sheet visible={Boolean(pinDurationFor)} onClose={() => setPinDurationFor(null)} title="Pin for how long?">
        {pinDurationFor ? (
          <View style={{ paddingBottom: 10 }}>
            <Text style={styles.pinPreview} numberOfLines={2}>
              {messagePreview(pinDurationFor)}
            </Text>
            {PIN_DURATIONS.map((duration) => (
              <SheetRow
                key={duration.label}
                icon="time-outline"
                label={duration.label}
                onPress={() => confirmPin(pinDurationFor, duration.hours)}
              />
            ))}
          </View>
        ) : null}
      </Sheet>

      <ConfirmSheet
        visible={Boolean(deleteTarget)}
        title="Delete this message?"
        message="It disappears for both of you."
        confirmLabel="Delete"
        destructive
        onConfirm={() => {
          const target = deleteTarget;
          setDeleteTarget(null);
          if (!target || !session?.access_token || !userId) return;

          const base = (process.env.EXPO_PUBLIC_API_BASE_URL || "https://whisper-anonymous.vercel.app").replace(/\/$/, "");
          void fetch(`${base}/api/chat/delete-message`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${session.access_token}`,
            },
            body: JSON.stringify({ messageId: target.id }),
          })
            .then((res) => {
              if (!res.ok) throw new Error("delete failed");
              setMessages((current) => current.filter((message) => message.id !== target.id));
              showToast("Message deleted", { variant: "subtle" });
            })
            .catch(() => showToast("Couldn't delete that message.", { variant: "error" }));
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </View>
  );
}

/* ---------------------------------------------------------------------------
 * Bubbles
 * ------------------------------------------------------------------------ */

/**
 * One message.
 *
 * Mine right-aligned on the gradient, theirs left on glass — direction is the
 * fastest thing to read in a column of text, and the gradient is what keeps
 * the brand present in a screen that is otherwise two columns of paragraphs.
 *
 * A view-once file that has not been opened is a compressed, labelled row
 * rather than an empty box, so "there is something hidden here" is legible from
 * the shape of the column alone.
 */
function MessageBubble({
  message,
  mine,
  claimedPhotoUri,
  claimedAudioUri,
  claiming,
  pinned,
  onClaim,
  onLongPress,
}: {
  message: DirectMessage;
  mine: boolean;
  claimedPhotoUri?: string;
  claimedAudioUri?: string;
  claiming: boolean;
  pinned: boolean;
  onClaim: () => void;
  onLongPress: () => void;
}) {
  const hasVoice = Boolean(message.audio_path);
  /* `image_viewed_at` counts as evidence a photo was here, not just
     `image_path`: a spent view-once photo has no path any more — the route
     nulls it — and without this the bubble would collapse to nothing. */
  const hasPhoto = Boolean(message.image_path) || Boolean(message.image_viewed_at);
  const isSticker = message.media_kind === "sticker" || message.media_kind === "gif";
  const viewed = Boolean(message.image_viewed_at || message.audio_viewed_at);
  const pending = message.id.startsWith("pending-");

  const showPhoto =
    claimedPhotoUri ?? (!message.is_view_once && !isSticker ? (message.media_url ?? undefined) : undefined);

  const body = (
    <BubbleBody
      message={message}
      mine={mine}
      hasPhoto={hasPhoto}
      hasVoice={hasVoice}
      isSticker={isSticker}
      viewed={viewed}
      claiming={claiming}
      photoUri={showPhoto}
      audioUri={claimedAudioUri}
      onClaim={onClaim}
    />
  );

  return (
    <Pressable
      onLongPress={onLongPress}
      delayLongPress={380}
      style={[styles.bubbleRow, mine && styles.bubbleRowMine]}
      accessibilityLabel={mine ? "Your message" : "Their message"}
    >
      {mine ? (
        <LinearGradient
          colors={GRADIENT_COLORS}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[styles.bubble, styles.bubbleMine]}
        >
          {body}
        </LinearGradient>
      ) : (
        <BlurView intensity={GLASS.blurIntensity} tint="dark" style={[styles.bubble, styles.bubbleTheirs]}>
          {body}
        </BlurView>
      )}

      <View style={[styles.metaRow, mine && styles.metaRowMine]}>
        {pinned ? <Ionicons name="pin" size={10} color={COLORS.warning} /> : null}
        <Text style={styles.meta}>{clockTime(message.created_at)}</Text>
        {mine && (
          <Ionicons
            name={message.read_at ? "checkmark-done" : message.delivered_at ? "checkmark-done" : "checkmark"}
            size={13}
            color={message.read_at ? COLORS.cyan : COLORS.subtle}
          />
        )}
        {pending && <Text style={styles.meta}>sending…</Text>}
      </View>
    </Pressable>
  );
}

function BubbleBody({
  message,
  mine,
  hasPhoto,
  hasVoice,
  isSticker,
  viewed,
  claiming,
  photoUri,
  audioUri,
  onClaim,
}: {
  message: DirectMessage;
  mine: boolean;
  hasPhoto: boolean;
  hasVoice: boolean;
  isSticker: boolean;
  viewed: boolean;
  claiming: boolean;
  photoUri?: string;
  audioUri?: string;
  onClaim: () => void;
}) {
  const accent = mine ? "#0a0814" : COLORS.text;

  return (
    <>
      {hasPhoto && (
        <Pressable
          onPress={viewed || photoUri ? undefined : onClaim}
          style={[styles.media, mine && styles.mediaTint]}
          accessibilityLabel={viewed ? "Viewed photo" : "Tap to view this photo once"}
        >
          {photoUri ? (
            <FadingPhoto uri={photoUri} />
          ) : (
            <View style={styles.mediaLocked}>
              <Ionicons name={viewed ? "eye-off-outline" : "image-outline"} size={20} color={accent} />
              <Text style={[styles.mediaText, { color: accent }]}>
                {claiming ? "Opening…" : viewed ? "Photo viewed" : "Tap to view once"}
              </Text>
            </View>
          )}
        </Pressable>
      )}

      {hasVoice && (
        <View style={styles.voiceWrap}>
          {audioUri ? (
            <VoiceNotePlayer
              uri={audioUri}
              durationMs={message.audio_duration_ms}
              peaks={message.audio_waveform}
              tone={mine ? "outgoing" : "incoming"}
            />
          ) : (
            <Pressable
              onPress={viewed ? undefined : onClaim}
              style={styles.mediaLocked}
              accessibilityLabel={viewed ? "Voice note already played" : "Play this voice note once"}
            >
              <Ionicons name={viewed ? "eye-off-outline" : "mic-outline"} size={18} color={accent} />
              <Text style={[styles.mediaText, { color: accent }]}>
                {claiming
                  ? "Opening…"
                  : viewed
                    ? "Voice note played"
                    : `Play · ${Math.max(1, Math.round((message.audio_duration_ms ?? 0) / 1000))}s`}
              </Text>
            </Pressable>
          )}
        </View>
      )}

      {isSticker && message.media_url ? (
        <Image source={{ uri: message.media_url }} style={styles.sticker} contentFit="contain" />
      ) : null}

      {message.content ? <Text style={[styles.bubbleText, { color: accent }]}>{message.content}</Text> : null}
    </>
  );
}

/** One of a kind, so it cannot be cached: a claimed view-once photo is bytes
    held in memory for as long as the bubble is mounted, and `expo-image`'s disk
    cache would outlive the claim it belongs to. */
function FadingPhoto({ uri }: { uri: string }) {
  const opacity = useSharedValue(0);

  useEffect(() => {
    opacity.value = withTiming(1, { duration: 240, easing: Easing.out(Easing.cubic) });
  }, [opacity]);

  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View style={[styles.photoWrap, style]}>
      <Image source={{ uri }} style={styles.photo} contentFit="cover" cachePolicy="memory" />
    </Animated.View>
  );
}

function DayDivider({ label }: { label: string }) {
  return (
    <View style={styles.divider}>
      <View style={styles.dividerLine} />
      <Text style={styles.dividerText}>{label}</Text>
      <View style={styles.dividerLine} />
    </View>
  );
}

/** The 40-coin gate, as a card rather than an error. */
function LockedBanner({
  cost,
  balance,
  busy,
  onUnlock,
}: {
  cost: number;
  balance: number | null;
  busy: boolean;
  onUnlock: () => void;
}) {
  const affordable = balance === null || balance >= cost;

  return (
    <View style={styles.locked}>
      <LinearGradient
        colors={["rgba(34,211,238,0.18)", "rgba(168,85,247,0.18)"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.lockedIcon}
      >
        <Ionicons name="lock-closed" size={26} color={COLORS.text} />
      </LinearGradient>

      <Text style={styles.lockedTitle}>This conversation is locked</Text>
      <Text style={styles.lockedBody}>
        You&apos;re not friends with this person yet. Unlock the thread once and it stays open — replies
        cost nothing after that.
      </Text>

      <Pressable
        onPress={onUnlock}
        disabled={busy || !affordable}
        accessibilityLabel={`Unlock for ${cost} coins`}
      >
        <LinearGradient
          colors={GRADIENT_COLORS}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={[styles.unlockButton, (!affordable || busy) && styles.disabled]}
        >
          <Ionicons name="logo-bitcoin" size={16} color="#0a0814" />
          <Text style={styles.unlockText}>
            {busy ? "Unlocking…" : affordable ? `Unlock · ${cost} coins` : `Need ${cost} coins`}
          </Text>
        </LinearGradient>
      </Pressable>

      {!affordable && <Text style={styles.lockedHint}>Top up in the Coin Store to open this thread.</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  pinBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: "rgba(245,158,11,0.08)",
    borderBottomWidth: 1,
    borderBottomColor: "rgba(245,158,11,0.28)",
  },
  pinBarMain: { flex: 1, flexDirection: "row", alignItems: "center", gap: 7 },
  pinBarText: { flex: 1, color: COLORS.warning, fontSize: 12, fontWeight: "700" },
  pinBarCount: { color: COLORS.warning, fontSize: 11, fontWeight: "800", opacity: 0.65 },
  pinBarUnpin: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(245,158,11,0.12)",
  },
  pinPreview: {
    color: COLORS.muted,
    fontSize: 12.5,
    lineHeight: 18,
    paddingHorizontal: 4,
    paddingBottom: 8,
    fontStyle: "italic",
  },

  root: { flex: 1, backgroundColor: COLORS.background },
  flex: { flex: 1 },

  header: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: GLASS.border, overflow: "hidden" },
  headerInner: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingBottom: 8 },
  headerWho: { flex: 1, flexDirection: "row", alignItems: "center", gap: 10 },
  headerText: { flex: 1 },
  headerName: { color: COLORS.text, fontSize: 15, fontWeight: "800" },
  headerStatus: { color: COLORS.cyan, fontSize: 11.5, fontWeight: "600", marginTop: 1 },

  list: { paddingHorizontal: 12, paddingTop: 12, paddingBottom: 16 },

  intro: { alignItems: "center", gap: 8, paddingVertical: 24, paddingHorizontal: 24 },
  introName: { color: COLORS.text, fontSize: 18, fontWeight: "900" },
  introText: { color: COLORS.muted, fontSize: 13, textAlign: "center", lineHeight: 19 },

  bubbleRow: { marginBottom: 8, alignItems: "flex-start", maxWidth: "86%" },
  bubbleRowMine: { alignSelf: "flex-end", alignItems: "flex-end" },
  bubble: {
    borderRadius: RADIUS.lg,
    paddingHorizontal: 13,
    paddingVertical: 10,
    borderWidth: 1,
    overflow: "hidden",
  },
  bubbleMine: { borderColor: "transparent", borderBottomRightRadius: RADIUS.sm },
  bubbleTheirs: {
    borderColor: GLASS.border,
    backgroundColor: "rgba(23,18,42,0.6)",
    borderBottomLeftRadius: RADIUS.sm,
  },
  bubbleText: { fontSize: 15, lineHeight: 21 },

  media: { borderRadius: RADIUS.md, overflow: "hidden", marginBottom: 8, minWidth: 168 },
  mediaTint: { backgroundColor: "rgba(10,8,20,0.14)" },
  mediaLocked: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 14, paddingVertical: 14 },
  mediaText: { fontSize: 13, fontWeight: "700" },
  photoWrap: { width: 200, height: 200, borderRadius: RADIUS.md, overflow: "hidden" },
  photo: { width: 200, height: 200 },
  voiceWrap: { marginBottom: 4 },
  sticker: { width: 120, height: 120, marginBottom: 4 },

  metaRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 3, paddingHorizontal: 4 },
  metaRowMine: { justifyContent: "flex-end" },
  meta: { color: COLORS.subtle, fontSize: 10.5, fontWeight: "600" },

  divider: { flexDirection: "row", alignItems: "center", gap: 10, marginVertical: 14, paddingHorizontal: 20 },
  dividerLine: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: GLASS.border },
  dividerText: { color: COLORS.subtle, fontSize: 11, fontWeight: "700" },

  composer: { paddingHorizontal: 12, paddingTop: 8 },
  composerInner: {
    borderRadius: RADIUS.xl,
    borderWidth: 1,
    borderColor: GLASS.border,
    backgroundColor: "rgba(23,18,42,0.6)",
    padding: 8,
    overflow: "hidden",
  },
  composerRow: { flexDirection: "row", alignItems: "flex-end", gap: 8 },
  composerIcon: { padding: 8, marginBottom: 2 },
  input: {
    flex: 1,
    color: COLORS.text,
    fontSize: 15.5,
    maxHeight: 120,
    paddingHorizontal: 6,
    paddingTop: 10,
    paddingBottom: 10,
  },
  sendButton: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  micButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(34,211,238,0.12)",
  },
  recorderError: { color: COLORS.danger, fontSize: 12, marginTop: 6, paddingHorizontal: 6 },
  composerHint: { color: COLORS.subtle, fontSize: 10.5, textAlign: "center", marginTop: 6 },

  locked: { alignItems: "center", gap: 10, paddingVertical: 40, paddingHorizontal: 28 },
  lockedIcon: { width: 76, height: 76, borderRadius: 38, alignItems: "center", justifyContent: "center" },
  lockedTitle: { color: COLORS.text, fontSize: 18, fontWeight: "900" },
  lockedBody: { color: COLORS.muted, fontSize: 13.5, textAlign: "center", lineHeight: 20 },
  unlockButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingHorizontal: 22,
    paddingVertical: 13,
    borderRadius: RADIUS.pill,
    marginTop: 6,
  },
  unlockText: { color: "#0a0814", fontSize: 15, fontWeight: "900" },
  lockedHint: { color: COLORS.subtle, fontSize: 12 },
  disabled: { opacity: 0.55 },
});
