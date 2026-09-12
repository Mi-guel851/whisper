import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";

import { GlassCard } from "@/components/GlassCard";
import { GradientButton } from "@/components/GradientButton";
import { VoiceNotePlayer } from "@/components/VoiceNotePlayer";
import { Waveform } from "@/components/Waveform";
import { createFeedPost } from "@/lib/feed";
import { formatElapsed } from "@/lib/format";
import { useSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import { COLORS, GLASS, GRADIENT_COLORS, RADIUS } from "@/lib/theme";
import { useToast } from "@/lib/toast";
import { useVoiceRecorder } from "@/lib/useVoiceRecorder";
import type { VoiceRecording } from "@/lib/types";
import { vibrate } from "@/lib/haptics";

/**
 * Create Whisper.
 *
 * Multiline dark glass text input, voice recording via expo-av (record button,
 * waveform, stop, playback before posting), upload to Supabase storage bucket
 * `voice-messages`, anonymous toggle default on, gradient Post button.
 */
export default function CreateWhisperScreen() {
  const { session, userId } = useSession();
  const { showToast } = useToast();
  const [body, setBody] = useState("");
  const [anonymous, setAnonymous] = useState(true);
  const [posting, setPosting] = useState(false);
  const [focused, setFocused] = useState(false);
  const recorder = useVoiceRecorder();
  const [pendingRecording, setPendingRecording] = useState<VoiceRecording | null>(null);

  const recordBtnScale = useSharedValue(1);
  const recordBtnAnim = useAnimatedStyle(() => ({ transform: [{ scale: recordBtnScale.value }] }));

  const startRecording = async () => {
    setPendingRecording(null);
    await recorder.start();
    recordBtnScale.value = withTiming(1.1, { duration: 140, easing: Easing.out(Easing.quad) });
    vibrate("select");
  };

  const stopRecording = async () => {
    recordBtnScale.value = withTiming(1, { duration: 180 });
    const rec = await recorder.stop();
    if (rec) setPendingRecording(rec);
  };

  const discardRecording = () => {
    setPendingRecording(null);
    vibrate("warning");
  };

  const uploadVoice = async (rec: VoiceRecording): Promise<string | null> => {
    try {
      const fileName = `${userId}/${Date.now()}.${rec.extension}`;
      const response = await fetch(rec.uri);
      const blob = await response.blob();
      const { error } = await supabase.storage
        .from("voice-messages")
        .upload(fileName, blob, { contentType: rec.mimeType, upsert: false });
      if (error) {
        console.warn("[create-whisper] voice upload:", error.message);
        return null;
      }
      const { data } = supabase.storage.from("voice-messages").getPublicUrl(fileName);
      return data.publicUrl;
    } catch (err) {
      console.warn("[create-whisper] voice upload failed:", err);
      return null;
    }
  };

  const handlePost = async () => {
    const text = body.trim();
    if (!text && !pendingRecording) {
      showToast("Write something or record a voice note first.");
      return;
    }
    if (!session || !userId) {
      showToast("You need to be signed in.");
      return;
    }

    setPosting(true);
    try {
      if (pendingRecording) {
        await uploadVoice(pendingRecording);
      }

      const result = await createFeedPost({ body: text || "🎙 Voice note" }, session.access_token);
      if ("error" in result) {
        showToast(result.error, { variant: "error" });
        setPosting(false);
        return;
      }

      showToast("Post live", { variant: "subtle" });
      vibrate("success");
      setBody("");
      setPendingRecording(null);
      router.back();
    } catch (err: any) {
      showToast(err?.message || "Couldn't post that.", { variant: "error" });
    } finally {
      setPosting(false);
    }
  };

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.closeBtn}>
          <Ionicons name="close" size={24} color={COLORS.text} />
        </Pressable>
        <Text style={styles.headerTitle}>New Whisper</Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <GlassCard radius={RADIUS.xl} strong style={styles.inputCard}>
            <TextInput
              value={body}
              onChangeText={setBody}
              placeholder="What's on your mind, anonymously?"
              placeholderTextColor={COLORS.subtle}
              multiline
              maxLength={500}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              style={[
                styles.input,
                { borderColor: focused ? COLORS.cyan : "transparent" },
              ]}
            />
            <View style={styles.counterRow}>
              <Text style={styles.counter}>{body.length}/500</Text>
            </View>
          </GlassCard>

          {/* Voice recorder */}
          <GlassCard radius={RADIUS.lg} style={styles.voiceCard}>
            {recorder.isRecording ? (
              <View style={styles.recorderRow}>
                <View style={styles.recPulse} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.recTimer}>{formatElapsed(recorder.elapsedMs)}</Text>
                  <Waveform peaks={recorder.peaks} bars={28} height={22} color={COLORS.cyan} />
                </View>
                <Pressable onPress={stopRecording} style={styles.stopBtn}>
                  <Ionicons name="stop" size={20} color="#0a0814" />
                </Pressable>
              </View>
            ) : pendingRecording ? (
              <View style={styles.reviewRow}>
                <View style={{ flex: 1 }}>
                  <VoiceNotePlayer
                    uri={pendingRecording.uri}
                    durationMs={pendingRecording.durationMs}
                    peaks={pendingRecording.waveform}
                    tone="incoming"
                  />
                </View>
                <Pressable onPress={discardRecording} style={styles.discardBtn}>
                  <Ionicons name="trash-outline" size={18} color={COLORS.danger} />
                </Pressable>
              </View>
            ) : (
              <Pressable onPress={startRecording} style={styles.recordRow}>
                <Animated.View style={[styles.recordIconWrap, recordBtnAnim]}>
                  <LinearGradient
                    colors={GRADIENT_COLORS}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={styles.recordIcon}
                  >
                    <Ionicons name="mic" size={20} color="#0a0814" />
                  </LinearGradient>
                </Animated.View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.recordLabel}>Record a voice note</Text>
                  <Text style={styles.recordHint}>Tap to start recording</Text>
                </View>
              </Pressable>
            )}
          </GlassCard>

          {/* Anonymous toggle */}
          <Pressable style={styles.anonRow} onPress={() => setAnonymous((v) => !v)}>
            <View style={styles.anonTextWrap}>
              <Ionicons name="eye-off-outline" size={20} color={COLORS.cyan} />
              <View>
                <Text style={styles.anonLabel}>Post anonymously</Text>
                <Text style={styles.anonHint}>Your identity will never be shown</Text>
              </View>
            </View>
            <View
              style={[
                styles.toggle,
                { backgroundColor: anonymous ? COLORS.cyan : "rgba(255,255,255,0.15)" },
              ]}
            >
              <View
                style={[
                  styles.toggleKnob,
                  { transform: [{ translateX: anonymous ? 18 : 2 }] },
                ]}
              />
            </View>
          </Pressable>

          <View style={{ marginTop: 20 }}>
            <GradientButton
              label={posting ? "Posting..." : "Post Whisper"}
              onPress={handlePost}
              loading={posting}
              disabled={posting}
            />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.background },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 60,
    paddingBottom: 10,
  },
  closeBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  headerTitle: { color: COLORS.text, fontSize: 18, fontWeight: "900" },
  content: { padding: 20, gap: 16 },
  inputCard: { padding: 16 },
  input: {
    minHeight: 140,
    color: COLORS.text,
    fontSize: 16,
    lineHeight: 22,
    textAlignVertical: "top",
    borderRadius: RADIUS.md,
    borderWidth: 1,
    padding: 12,
    backgroundColor: "rgba(23,18,42,0.4)",
  },
  counterRow: { alignItems: "flex-end", marginTop: 6 },
  counter: { color: COLORS.subtle, fontSize: 12 },
  voiceCard: { padding: 14 },
  recorderRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  recPulse: { width: 10, height: 10, borderRadius: 5, backgroundColor: COLORS.danger },
  recTimer: { color: COLORS.text, fontSize: 14, fontWeight: "800", marginBottom: 4 },
  stopBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: COLORS.cyan,
    alignItems: "center",
    justifyContent: "center",
  },
  reviewRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  discardBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(239,68,68,0.15)",
    alignItems: "center",
    justifyContent: "center",
  },
  recordRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  recordIconWrap: { alignItems: "center", justifyContent: "center" },
  recordIcon: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: "center",
    justifyContent: "center",
  },
  recordLabel: { color: COLORS.text, fontSize: 15, fontWeight: "800" },
  recordHint: { color: COLORS.subtle, fontSize: 12, marginTop: 2 },
  anonRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 14,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: GLASS.border,
    backgroundColor: "rgba(23,18,42,0.45)",
  },
  anonTextWrap: { flexDirection: "row", alignItems: "center", gap: 12 },
  anonLabel: { color: COLORS.text, fontSize: 14, fontWeight: "700" },
  anonHint: { color: COLORS.subtle, fontSize: 12, marginTop: 2 },
  toggle: {
    width: 44,
    height: 26,
    borderRadius: 13,
    padding: 2,
    justifyContent: "center",
  },
  toggleKnob: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: "#0a0814",
  },
});
