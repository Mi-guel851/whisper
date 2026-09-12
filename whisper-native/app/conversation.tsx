import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useLocalSearchParams, router } from "expo-router";
import { useEffect, useRef, useState } from "react";
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

import { Avatar } from "@/components/Avatar";
import { GlassCard } from "@/components/GlassCard";
import { COLORS, GLASS, GRADIENT_COLORS, RADIUS } from "@/lib/theme";
import { useSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import {
  fetchConversation,
  fetchMessages,
  markRead,
  otherParticipant,
  sendMessage,
  stampConversationRead,
} from "@/lib/dms";
import type { ConversationRow, DirectMessage } from "@/lib/types";
import { clockTime } from "@/lib/format";
import { useAnonName } from "@/lib/identity";
import { useToast } from "@/lib/toast";
import { vibrate } from "@/lib/haptics";

/**
 * Conversation screen.
 *
 * Chat bubbles: sent (right) cyan gradient, received (left) dark glass. Send
 * input at bottom with gradient send button.
 */
export default function ConversationScreen() {
  const { conversationId } = useLocalSearchParams<{ conversationId: string }>();
  const { userId } = useSession();
  const { showToast } = useToast();

  const [conversation, setConversation] = useState<ConversationRow | null>(null);
  const [messages, setMessages] = useState<DirectMessage[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const listRef = useRef<FlatList>(null);

  useEffect(() => {
    if (!conversationId || !userId) return;
    (async () => {
      const c = await fetchConversation(conversationId);
      setConversation(c);
      const msgs = await fetchMessages(conversationId);
      setMessages(msgs);

      // mark as read
      const incoming = msgs.filter((m) => m.sender_id !== userId).map((m) => m.id);
      if (incoming.length > 0) await markRead(incoming);
      await stampConversationRead(conversationId, userId, c);
    })();

    const channel = supabase
      .channel(`chat-${conversationId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "direct_messages",
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          const newMsg = payload.new as DirectMessage;
          setMessages((prev) => [...prev, newMsg]);
          if (newMsg.sender_id !== userId) {
            markRead([newMsg.id]).catch(() => {});
          }
          setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [conversationId, userId]);

  const otherId = conversation ? otherParticipant(conversation, userId ?? "") : null;
  const name = useAnonName(otherId);

  const handleSend = async () => {
    const content = text.trim();
    if (!content || !userId || !conversationId || sending) return;
    setSending(true);
    const result = await sendMessage({
      conversationId,
      senderId: userId,
      content,
    });
    setSending(false);
    if (result.ok) {
      setMessages((prev) => [...prev, result.message]);
      setText("");
      vibrate("tap");
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 80);
    } else {
      showToast(result.error, { variant: "error" });
    }
  };

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color={COLORS.text} />
        </Pressable>
        <View style={styles.headerCenter}>
          {otherId && <Avatar authorId={otherId} size={36} />}
          <Text style={styles.headerTitle} numberOfLines={1}>
            {name}
          </Text>
        </View>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={88}
      >
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(m) => m.id}
          renderItem={({ item }) => <ChatBubble message={item} myId={userId ?? ""} />}
          contentContainerStyle={{ padding: 16, gap: 8, paddingBottom: 20 }}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
        />

        <View style={styles.inputBar}>
          <GlassCard radius={RADIUS.pill} padded={false} style={styles.inputWrap}>
            <TextInput
              value={text}
              onChangeText={setText}
              placeholder="Message..."
              placeholderTextColor={COLORS.subtle}
              multiline
              style={styles.input}
            />
          </GlassCard>
          <Pressable onPress={handleSend} disabled={sending || !text.trim()}>
            <LinearGradient
              colors={text.trim() && !sending ? GRADIENT_COLORS : ["rgba(255,255,255,0.1)", "rgba(255,255,255,0.1)"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.sendBtn}
            >
              <Ionicons name="send" size={18} color={text.trim() ? "#0a0814" : COLORS.subtle} />
            </LinearGradient>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

function ChatBubble({ message, myId }: { message: DirectMessage; myId: string }) {
  const mine = message.sender_id === myId;
  return (
    <View style={[styles.bubbleRow, mine && styles.bubbleRowMine]}>
      {mine ? (
        <LinearGradient
          colors={GRADIENT_COLORS}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[styles.bubble, styles.bubbleMine]}
        >
          <Text style={[styles.bubbleText, { color: "#0a0814" }]}>{message.content}</Text>
          <Text style={[styles.bubbleTime, { color: "rgba(10,8,20,0.6)" }]}>
            {clockTime(message.created_at)}
          </Text>
        </LinearGradient>
      ) : (
        <View style={[styles.bubble, styles.bubbleTheirs]}>
          <Text style={styles.bubbleText}>{message.content}</Text>
          <Text style={styles.bubbleTime}>{clockTime(message.created_at)}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.background },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 8,
    paddingTop: 50,
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: GLASS.border,
  },
  backBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  headerCenter: { flexDirection: "row", alignItems: "center", gap: 10, flex: 1, justifyContent: "center" },
  headerTitle: { color: COLORS.text, fontSize: 16, fontWeight: "800", flex: 0 },
  bubbleRow: { flexDirection: "row", maxWidth: "80%" },
  bubbleRowMine: { alignSelf: "flex-end", justifyContent: "flex-end" },
  bubble: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: RADIUS.xl,
    gap: 4,
    maxWidth: "100%",
  },
  bubbleMine: {
    borderBottomRightRadius: 6,
  },
  bubbleTheirs: {
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: GLASS.border,
    borderBottomLeftRadius: 6,
  },
  bubbleText: { color: COLORS.text, fontSize: 15, lineHeight: 20 },
  bubbleTime: { fontSize: 10, color: COLORS.subtle, alignSelf: "flex-end", fontWeight: "600" },
  inputBar: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: GLASS.border,
    backgroundColor: "rgba(10,8,20,0.9)",
  },
  inputWrap: { flex: 1 },
  input: {
    color: COLORS.text,
    fontSize: 15,
    paddingHorizontal: 16,
    paddingVertical: 10,
    maxHeight: 120,
  },
  sendBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
  },
});
