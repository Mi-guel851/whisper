import { Ionicons } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { COLORS, GLASS, GRADIENT_COLORS, RADIUS, glow, useStyles } from "@/lib/theme";
import { vibrate } from "@/lib/haptics";
import {
  AI_LIMITS,
  QUICK_QUESTIONS,
  askWhispersAi,
  type AiTurn,
} from "@/lib/whispersAi";

type Bubble = AiTurn & { id: string; failed?: boolean };

let bubbleSeq = 0;
const nextId = () => `ai-${++bubbleSeq}`;

/**
 * Whispers AI — the assistant, as a panel that grows out of its button.
 *
 * A DIRECT PORT of the web app's `components/ai/WhispersAiAssistant.tsx`. The
 * transcript lives in memory only: closing the panel is the end of the
 * conversation, which is what the site promises, and it means nothing about what
 * people ask is written anywhere.
 *
 * The layout follows the site's phone presentation — a tall glass sheet pinned to
 * the bottom edge, rounded at the top, with the header fixed and the transcript
 * scrolling under it. The keyboard is handled with `KeyboardAvoidingView`, so the
 * composer stays on screen while typing.
 */
export function WhispersAi({ bottomOffset = 0 }: { bottomOffset?: number }) {
  const styles = useStyles(makeStyles);
  const insets = useSafeAreaInsets();

  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<{ message: string; retryable: boolean } | null>(null);

  const listRef = useRef<FlatList<Bubble>>(null);
  const retryRef = useRef<string | null>(null);
  const bubblesRef = useRef<Bubble[]>([]);

  useEffect(() => {
    bubblesRef.current = bubbles;
  }, [bubbles]);

  /* The panel slides in from the edge its button sits on. */
  const progress = useSharedValue(0);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    if (open) {
      setMounted(true);
      progress.value = withTiming(1, { duration: 280, easing: Easing.out(Easing.cubic) });
      return;
    }

    progress.value = withTiming(0, { duration: 200, easing: Easing.in(Easing.cubic) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const backdropStyle = useAnimatedStyle(() => ({ opacity: progress.value * 0.9 }));
  const panelStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: (1 - progress.value) * 90 }],
    opacity: progress.value,
  }));

  /* Three dots breathing while the answer is in flight. */
  const pulse = useSharedValue(0.35);
  useEffect(() => {
    if (!pending) return;
    pulse.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 520, easing: Easing.inOut(Easing.quad) }),
        withTiming(0.35, { duration: 520, easing: Easing.inOut(Easing.quad) })
      ),
      -1
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending]);

  const pulseStyle = useAnimatedStyle(() => ({ opacity: pulse.value }));

  const ask = useCallback(
    async (question: string) => {
      const trimmed = question.trim();
      if (!trimmed || pending) return;

      const history = bubblesRef.current
        .filter((bubble) => !bubble.failed)
        .map(({ role, content }) => ({ role, content }));

      setBubbles((current) => [...current, { id: nextId(), role: "user", content: trimmed }]);
      setDraft("");
      setError(null);
      setPending(true);
      retryRef.current = trimmed;
      vibrate("tap");

      const result = await askWhispersAi({ message: trimmed, history, context: { page: "feed" } });

      setPending(false);

      if (result.ok) {
        retryRef.current = null;
        setBubbles((current) => [
          ...current,
          { id: nextId(), role: "assistant", content: result.reply },
        ]);
        return;
      }

      setError({ message: result.message, retryable: result.retryable });
      if (!result.retryable) retryRef.current = null;
      vibrate("warning");
    },
    [pending]
  );

  const retry = () => {
    const question = retryRef.current;
    if (!question) return;
    /* The failed question is already in the transcript; asking again without
       removing it would leave the model with the same question twice. */
    setBubbles((current) => {
      const last = current[current.length - 1];
      return last && last.role === "user" ? current.slice(0, -1) : current;
    });
    void ask(question);
  };

  return (
    <>
      {/* The launcher: the same gradient chip the site parks in the corner. */}
      <Pressable
        onPress={() => {
          vibrate("tap");
          setOpen(true);
        }}
        style={[styles.fabWrap, { bottom: bottomOffset }]}
        accessibilityRole="button"
        accessibilityLabel="Ask Whispers AI"
      >
        <LinearGradient
          colors={GRADIENT_COLORS}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[styles.fab, glow(COLORS.purple, 18, 0.45)]}
        >
          <Ionicons name="sparkles" size={20} color={COLORS.contrast} />
        </LinearGradient>
      </Pressable>

      <Modal transparent visible={mounted} animationType="none" onRequestClose={() => setOpen(false)}>
        <View style={styles.root}>
          <Animated.View style={[styles.backdrop, backdropStyle]}>
            <BlurView intensity={24} tint="dark" style={StyleSheet.absoluteFill} />
            <Pressable style={StyleSheet.absoluteFill} onPress={() => setOpen(false)} accessibilityLabel="Close" />
          </Animated.View>

          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : undefined}
            style={styles.avoider}
          >
            <Animated.View style={[styles.panel, panelStyle, { paddingBottom: Math.max(insets.bottom, 12) }]}>
              <BlurView intensity={GLASS.blurIntensity} tint="dark" style={StyleSheet.absoluteFill} />

              <View style={styles.header}>
                <LinearGradient
                  colors={GRADIENT_COLORS}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.headerMark}
                >
                  <Ionicons name="sparkles" size={17} color={COLORS.contrast} />
                </LinearGradient>

                <View style={styles.headerText}>
                  <Text style={styles.title}>Whispers AI</Text>
                  <Text style={styles.subtitle}>Ask how Whisper works</Text>
                </View>

                <Pressable
                  onPress={() => setOpen(false)}
                  hitSlop={12}
                  accessibilityLabel="Close Whispers AI"
                >
                  <Ionicons name="close" size={22} color={COLORS.muted} />
                </Pressable>
              </View>

              <FlatList
                ref={listRef}
                data={bubbles}
                keyExtractor={(item) => item.id}
                contentContainerStyle={styles.transcript}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
                onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
                ListEmptyComponent={
                  <View style={styles.empty}>
                    <Text style={styles.emptyTitle}>What can I help with?</Text>
                    <Text style={styles.emptyBody}>
                      I know Whisper — whispers, coins, wallets, hints, settings. I can't see your
                      messages or your account, and nothing here is saved.
                    </Text>

                    <View style={styles.quickRow}>
                      {QUICK_QUESTIONS.map((question) => (
                        <Pressable
                          key={question}
                          onPress={() => void ask(question)}
                          style={styles.quickChip}
                          accessibilityRole="button"
                        >
                          <Text style={styles.quickText}>{question}</Text>
                        </Pressable>
                      ))}
                    </View>
                  </View>
                }
                renderItem={({ item }) =>
                  item.role === "user" ? (
                    <View style={styles.userRow}>
                      <LinearGradient
                        colors={GRADIENT_COLORS}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 1 }}
                        style={styles.userBubble}
                      >
                        <Text style={styles.userText}>{item.content}</Text>
                      </LinearGradient>
                    </View>
                  ) : (
                    <View style={styles.aiRow}>
                      <View style={styles.aiBubble}>
                        <Text style={styles.aiText}>{item.content}</Text>
                      </View>
                    </View>
                  )
                }
                ListFooterComponent={
                  pending ? (
                    <View style={styles.aiRow}>
                      <Animated.View style={[styles.aiBubble, styles.thinking, pulseStyle]}>
                        <Text style={styles.thinkingText}>Thinking…</Text>
                      </Animated.View>
                    </View>
                  ) : error ? (
                    <View style={styles.errorRow}>
                      <Ionicons name="alert-circle-outline" size={16} color={COLORS.warning} />
                      <Text style={styles.errorText}>{error.message}</Text>
                      {error.retryable && retryRef.current && (
                        <Pressable onPress={retry} hitSlop={8} accessibilityRole="button">
                          <Text style={styles.retryText}>Retry</Text>
                        </Pressable>
                      )}
                    </View>
                  ) : null
                }
              />

              <View style={styles.composer}>
                <TextInput
                  value={draft}
                  onChangeText={(value) => setDraft(value.slice(0, AI_LIMITS.MAX_QUESTION_CHARS))}
                  placeholder="Ask a question…"
                  placeholderTextColor={COLORS.subtle}
                  keyboardAppearance="dark"
                  multiline
                  style={styles.input}
                />

                <Pressable
                  onPress={() => void ask(draft)}
                  disabled={!draft.trim() || pending}
                  style={[styles.send, (!draft.trim() || pending) && styles.sendOff]}
                  accessibilityLabel="Send"
                >
                  <LinearGradient
                    colors={GRADIENT_COLORS}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={styles.sendGradient}
                  >
                    <Ionicons name="arrow-up" size={18} color={COLORS.contrast} />
                  </LinearGradient>
                </Pressable>
              </View>
            </Animated.View>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </>
  );
}

const makeStyles = () => StyleSheet.create({
  fabWrap: { position: "absolute", right: 18 },
  fab: { width: 46, height: 46, borderRadius: 23, alignItems: "center", justifyContent: "center" },

  root: { flex: 1, justifyContent: "flex-end" },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(4,4,10,0.55)" },
  avoider: { justifyContent: "flex-end" },
  panel: {
    maxHeight: "82%",
    minHeight: 380,
    borderTopLeftRadius: RADIUS.xxl,
    borderTopRightRadius: RADIUS.xxl,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.09)",
    overflow: "hidden",
    backgroundColor: "rgba(18,14,32,0.72)",
  },

  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.07)",
  },
  headerMark: { width: 36, height: 36, borderRadius: RADIUS.sm, alignItems: "center", justifyContent: "center" },
  headerText: { flex: 1 },
  title: { color: COLORS.text, fontSize: 15, fontWeight: "800" },
  subtitle: { color: COLORS.muted, fontSize: 12, marginTop: 2 },

  transcript: { paddingHorizontal: 16, paddingVertical: 14, gap: 10 },
  empty: { paddingTop: 6 },
  emptyTitle: { color: COLORS.text, fontSize: 16, fontWeight: "800" },
  emptyBody: { color: COLORS.muted, fontSize: 13, lineHeight: 19, marginTop: 6 },
  quickRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 14 },
  quickChip: {
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderRadius: RADIUS.pill,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  quickText: { color: COLORS.text, fontSize: 12.5, fontWeight: "600" },

  userRow: { alignItems: "flex-end" },
  userBubble: { maxWidth: "86%", borderRadius: 18, borderBottomRightRadius: 6, paddingHorizontal: 14, paddingVertical: 10 },
  userText: { color: COLORS.contrast, fontSize: 14, fontWeight: "700", lineHeight: 20 },

  aiRow: { alignItems: "flex-start" },
  aiBubble: {
    maxWidth: "92%",
    borderRadius: 18,
    borderBottomLeftRadius: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  aiText: { color: COLORS.text, fontSize: 14, lineHeight: 21 },
  thinking: { opacity: 0.7 },
  thinkingText: { color: COLORS.muted, fontSize: 13, fontStyle: "italic" },

  errorRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 4 },
  errorText: { color: COLORS.warning, fontSize: 12.5, flex: 1, lineHeight: 18 },
  retryText: { color: COLORS.cyan, fontSize: 12.5, fontWeight: "800" },

  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 10,
    paddingHorizontal: 14,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.07)",
  },
  input: {
    flex: 1,
    maxHeight: 110,
    color: COLORS.text,
    fontSize: 14.5,
    lineHeight: 20,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: "rgba(255,255,255,0.04)",
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  send: { borderRadius: 22, overflow: "hidden", marginBottom: 2 },
  sendOff: { opacity: 0.45 },
  sendGradient: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
});
