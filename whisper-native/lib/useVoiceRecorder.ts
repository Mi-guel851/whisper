import { Audio } from "expo-av";
import { useCallback, useEffect, useRef, useState } from "react";
import { Platform } from "react-native";

import type { VoiceRecording } from "./types";

/**
 * Microphone capture for voice notes.
 *
 * The same contract as the web app's `lib/useVoiceRecorder.ts` — status,
 * elapsed time, live peaks, and a `stop()` that resolves a finished recording —
 * because the screens that use it are ports, and a different shape would mean
 * rewriting both of them rather than one.
 *
 * TWO THINGS THAT ARE NATIVE-SPECIFIC
 *
 *  1. Format. The web records WebM/Opus on Chromium and MP4/AAC on WebKit. A
 *     phone can record AAC in an MP4 container on both platforms, which every
 *     player in this ecosystem handles, and `audio/mp4` is on the
 *     `voice-messages` bucket's allowlist — so the upload is accepted without a
 *     transcode.
 *  2. Metering. `isMeteringEnabled` puts a dB level in the status callback, and
 *     that is what the waveform is drawn from. The peaks are stored with the
 *     message (`audio_waveform`) so the receiver's waveform is the sender's
 *     actual one rather than a decode of the file on every open.
 *
 * The elapsed clock is driven from the recording's own `durationMillis` rather
 * than a wall-clock timer, because a timer and the recorder disagree the moment
 * the app is backgrounded mid-recording — and the stored duration has to be the
 * audio's, not the UI's.
 */

export type RecorderStatus = "idle" | "recording" | "paused" | "finishing";

export type Recorder = {
  status: RecorderStatus;
  /** Paused counts as recording for the UI's purposes: the panel stays up. */
  isRecording: boolean;
  isPaused: boolean;
  elapsedMs: number;
  peaks: number[];
  error: string | null;
  clearError: () => void;
  start: () => Promise<void>;
  stop: () => Promise<VoiceRecording | null>;
  cancel: () => Promise<void>;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
};

/** AAC/MP4 on both platforms — see the note at the top of the file. */
const RECORDING_OPTIONS: Audio.RecordingOptions = {
  isMeteringEnabled: true,
  android: {
    extension: ".m4a",
    outputFormat: Audio.AndroidOutputFormat.MPEG_4,
    audioEncoder: Audio.AndroidAudioEncoder.AAC,
    sampleRate: 44100,
    numberOfChannels: 1,
    bitRate: 128000,
  },
  ios: {
    extension: ".m4a",
    outputFormat: Audio.IOSOutputFormat.MPEG4AAC,
    audioQuality: Audio.IOSAudioQuality.HIGH,
    sampleRate: 44100,
    numberOfChannels: 1,
    bitRate: 128000,
    linearPCMBitDepth: 16,
    linearPCMIsBigEndian: false,
    linearPCMIsFloat: false,
  },
  web: {
    mimeType: "audio/webm",
    bitsPerSecond: 128000,
  },
};

/** WhatsApp caps voice notes; an unbounded recorder is a memory leak with a UI. */
export const MAX_RECORDING_MS = 5 * 60 * 1000;

/** Peaks are sampled ~10/sec, matching the web client's stored waveform. */
const SAMPLE_INTERVAL_MS = 100;

/** dBFS → 0–100. Silence sits near -60, a voice peaks around -10. */
function meteringToPeak(metering: number | undefined): number {
  if (typeof metering !== "number" || Number.isNaN(metering)) return 6;
  const floor = -60;
  const normalized = ((metering - floor) / -floor) * 100;
  return Math.max(4, Math.min(100, Math.round(normalized)));
}

export function useVoiceRecorder(): Recorder {
  const [status, setStatus] = useState<RecorderStatus>("idle");
  const [elapsedMs, setElapsedMs] = useState(0);
  const [peaks, setPeaks] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);

  const recordingRef = useRef<Audio.Recording | null>(null);
  const peaksRef = useRef<number[]>([]);
  const durationRef = useRef(0);

  /** Never leave the microphone open behind a screen the user has left. */
  useEffect(() => {
    return () => {
      const recording = recordingRef.current;
      recordingRef.current = null;
      if (recording) {
        recording.stopAndUnloadAsync().catch(() => {});
      }
    };
  }, []);

  const onStatus = useCallback((update: Audio.RecordingStatus) => {
    /* A status callback can arrive before the recorder is prepared; those
       updates carry no duration and would reset the clock to zero. */
    if (!update.canRecord && !update.isRecording && !update.durationMillis) return;

    durationRef.current = update.durationMillis ?? durationRef.current;
    setElapsedMs(durationRef.current);

    if (update.isRecording && typeof update.metering === "number") {
      const peak = meteringToPeak(update.metering);
      peaksRef.current = [...peaksRef.current, peak].slice(-600);
      setPeaks(peaksRef.current);
    }
  }, []);

  const start = useCallback(async () => {
    if (recordingRef.current) return;

    setError(null);
    peaksRef.current = [];
    durationRef.current = 0;
    setPeaks([]);
    setElapsedMs(0);

    try {
      const permission = await Audio.requestPermissionsAsync();
      if (!permission.granted) {
        setError("Microphone access was blocked. Allow it in your settings to send voice notes.");
        return;
      }

      /* Recording and playback need different audio-session modes; this is the
         one switch that makes the recorder actually capture on iOS instead of
         silently producing a file of silence. */
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
        staysActiveInBackground: false,
        shouldDuckAndroid: true,
        playThroughEarpieceAndroid: false,
        interruptionModeIOS: 1,
        interruptionModeAndroid: 1,
      });

      const { recording } = await Audio.Recording.createAsync(
        RECORDING_OPTIONS,
        onStatus,
        SAMPLE_INTERVAL_MS
      );

      recordingRef.current = recording;
      setStatus("recording");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't start recording.");
      setStatus("idle");
    }
  }, [onStatus]);

  const stop = useCallback(async (): Promise<VoiceRecording | null> => {
    const recording = recordingRef.current;
    if (!recording) return null;

    setStatus("finishing");

    try {
      await recording.stopAndUnloadAsync();
      const uri = recording.getURI();
      recordingRef.current = null;

      /* Back to playback mode — leaving the session in record mode routes the
         next audio playback through the earpiece at call volume. */
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
        shouldDuckAndroid: true,
        playThroughEarpieceAndroid: false,
      });

      setStatus("idle");

      if (!uri) {
        setError("That recording couldn't be saved. Please try again.");
        return null;
      }

      return {
        uri,
        durationMs: durationRef.current,
        waveform: peaksRef.current.length > 0 ? peaksRef.current : [10, 20, 30],
        mimeType: "audio/mp4",
        extension: "m4a",
      };
    } catch (cause) {
      recordingRef.current = null;
      setStatus("idle");
      setError(cause instanceof Error ? cause.message : "Couldn't finish that recording.");
      return null;
    }
  }, []);

  const cancel = useCallback(async () => {
    const recording = recordingRef.current;
    recordingRef.current = null;
    peaksRef.current = [];
    setPeaks([]);
    setElapsedMs(0);
    setStatus("idle");

    if (!recording) return;
    try {
      await recording.stopAndUnloadAsync();
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false });
    } catch {
      /* Discarding a recording that already stopped is not worth a message. */
    }
  }, []);

  const pause = useCallback(async () => {
    const recording = recordingRef.current;
    if (!recording) return;
    try {
      await recording.pauseAsync();
      setStatus("paused");
    } catch {
      setError("Couldn't pause the recording.");
    }
  }, []);

  const resume = useCallback(async () => {
    const recording = recordingRef.current;
    if (!recording) return;
    try {
      await recording.startAsync();
      setStatus("recording");
    } catch {
      setError("Couldn't resume the recording.");
    }
  }, []);

  const clearError = useCallback(() => setError(null), []);

  /* The auto-stop at the cap is enforced here rather than in the UI so it holds
     for every entry point — including a hold-to-record gesture that the user
     forgot was still held. */
  useEffect(() => {
    if (status !== "recording" || elapsedMs < MAX_RECORDING_MS) return;
    void stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elapsedMs, status]);

  return {
    status,
    isRecording: status === "recording" || status === "paused" || status === "finishing",
    isPaused: status === "paused",
    elapsedMs,
    peaks,
    error,
    clearError,
    start,
    stop,
    cancel,
    pause,
    resume,
  };
}

/** The platform's recording extension, for a filename. */
export const RECORDING_EXTENSION = Platform.select({ ios: "m4a", android: "m4a", default: "webm" }) ?? "m4a";
