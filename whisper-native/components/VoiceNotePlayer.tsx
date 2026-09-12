import { Ionicons } from "@expo/vector-icons";
import { Audio, type AVPlaybackStatus } from "expo-av";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import { Waveform } from "./Waveform";
import { formatDuration } from "@/lib/format";
import { COLORS, useStyles } from "@/lib/theme";

/**
 * Plays a voice note.
 *
 * `uri` may be a local file (a note the user just recorded), a remote URL, or —
 * for a view-once note — a value produced by the claim route. The component does
 * not care which; it owns one `Audio.Sound` at a time and unloads it on unmount,
 * which is what stops a scroll through twenty voice notes from leaving twenty
 * sounds resident.
 *
 * Playback of a view-once note begins only after the caller has claimed it, so
 * the promise the sender was given ("this can be played once") is enforced before
 * any audio exists on the device — not by hiding a control after the fact.
 */
export function VoiceNotePlayer({
  uri,
  durationMs,
  peaks,
  onClaim,
  autoPlay = false,
  tone = "incoming",
}: {
  /** Null while the note is still being claimed. */
  uri: string | null;
  durationMs: number | null;
  peaks: number[] | null;
  /** Claims the audio, for a view-once note that has not been opened yet. */
  onClaim?: () => Promise<string | null>;
  autoPlay?: boolean;
  /** `incoming` is a glass bubble; `outgoing` is the gradient one. */
  tone?: "incoming" | "outgoing";
}) {
  const styles = useStyles(makeStyles);
  const soundRef = useRef<Audio.Sound | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "playing" | "paused" | "error">("idle");
  const [position, setPosition] = useState(0);
  const [source, setSource] = useState<string | null>(uri);
  const [error, setError] = useState<string | null>(null);
  const claimed = useRef(false);

  useEffect(() => setSource(uri), [uri]);

  /* One sound, always unloaded. */
  useEffect(() => {
    return () => {
      const sound = soundRef.current;
      soundRef.current = null;
      if (sound) void sound.unloadAsync().catch(() => {});
    };
  }, []);

  const onPlaybackStatus = useCallback((update: AVPlaybackStatus) => {
    if (!update.isLoaded) return;
    setPosition(update.positionMillis ?? 0);
    if (update.didJustFinish) {
      setStatus("idle");
      setPosition(0);
    }
  }, []);

  const ensureLoaded = useCallback(async (): Promise<Audio.Sound | null> => {
    if (soundRef.current) return soundRef.current;

    let target = source;

    /* A view-once note is fetched exactly once, when it is first played. */
    if (!target && onClaim && !claimed.current) {
      claimed.current = true;
      setStatus("loading");
      target = await onClaim();

      if (!target) {
        setStatus("error");
        setError("That voice note is no longer available.");
        return null;
      }
      setSource(target);
    }

    if (!target) {
      setStatus("error");
      setError("That voice note is no longer available.");
      return null;
    }

    await Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
      playsInSilentModeIOS: true,
      shouldDuckAndroid: true,
      playThroughEarpieceAndroid: false,
    });

    const { sound } = await Audio.Sound.createAsync({ uri: target }, { shouldPlay: false }, onPlaybackStatus);
    soundRef.current = sound;
    return sound;
  }, [onClaim, onPlaybackStatus, source]);

  const toggle = useCallback(async () => {
    try {
      const sound = await ensureLoaded();
      if (!sound) return;

      if (status === "playing") {
        await sound.pauseAsync();
        setStatus("paused");
        return;
      }

      await sound.playAsync();
      setStatus("playing");
    } catch {
      setStatus("error");
      setError("Couldn't play that voice note.");
    }
  }, [ensureLoaded, status]);

  /* Autoplay is used by the chat's "just received" case, where the bubble
     arrives with the user's thumb already on it. */
  useEffect(() => {
    if (!autoPlay) return;
    void toggle();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoPlay]);

  const total = (durationMs ?? 0) / 1000;
  const progress = total > 0 ? Math.min(1, position / 1000 / total) : 0;

  const accent = tone === "outgoing" ? COLORS.contrast : COLORS.text;

  return (
    <View style={[styles.row, tone === "outgoing" && styles.rowOutgoing]}>
      <Pressable
        onPress={toggle}
        disabled={status === "loading"}
        style={[styles.button, tone === "outgoing" && styles.buttonOutgoing]}
        accessibilityRole="button"
        accessibilityLabel={status === "playing" ? "Pause voice note" : "Play voice note"}
      >
        {status === "loading" ? (
          <ActivityIndicator size="small" color={accent} />
        ) : (
          <Ionicons name={status === "playing" ? "pause" : "play"} size={16} color={accent} />
        )}
      </Pressable>

      <View style={styles.body}>
        <Waveform
          peaks={peaks ?? []}
          progress={progress}
          bars={30}
          height={24}
          color={tone === "outgoing" ? COLORS.contrast : COLORS.cyan}
          inactiveColor={tone === "outgoing" ? "rgba(10,8,20,0.35)" : "rgba(255,255,255,0.2)"}
        />
        <Text style={[styles.time, tone === "outgoing" && { color: "rgba(10,8,20,0.75)" }]}>
          {status === "playing" || status === "paused"
            ? formatDuration(position)
            : formatDuration(durationMs ?? 0)}
        </Text>
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const makeStyles = () => StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 10, minWidth: 190 },
  rowOutgoing: {},
  button: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  buttonOutgoing: { backgroundColor: "rgba(10,8,20,0.16)" },
  body: { flex: 1, gap: 4 },
  time: { color: COLORS.muted, fontSize: 11, fontWeight: "700" },
  error: { color: COLORS.danger, fontSize: 11, maxWidth: 120 },
});

