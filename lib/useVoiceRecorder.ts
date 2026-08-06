"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Microphone capture for voice notes.
 *
 * Three things here are load-bearing and were the reason the old inline
 * recorder produced files nothing could play back.
 *
 * **The container is negotiated, not assumed.** The previous code did
 * `new MediaRecorder(stream)` and then `new Blob(chunks, { type: "audio/webm" })`.
 * On Chromium that happens to be true. On WebKit — every iOS browser, and the
 * iOS Capacitor shell — `MediaRecorder` produces MP4/AAC, so the blob was
 * labelled `audio/webm` while containing MP4, stored with a `.webm` extension,
 * and served back with a `Content-Type` that made both `<audio>` and the
 * platform decoder refuse it. Here the type comes from `recorder.mimeType`,
 * which is what the browser actually wrote.
 *
 * **Peaks are sampled live, not decoded afterwards.** Drawing a waveform from
 * the finished file means `decodeAudioData` over the whole clip — hundreds of
 * milliseconds of main-thread time on a mid-range phone, paid again by the
 * receiver on every open. An `AnalyserNode` running during capture gives the
 * same shape for free, and it's the sender's real signal rather than a
 * re-derivation of it.
 *
 * **Errors are distinguishable.** `getUserMedia` fails for reasons the user can
 * act on — permission refused, no input device, another app holding the mic —
 * and "Unable to access microphone" told them none of it.
 */

export type VoiceRecording = {
  blob: Blob;
  mimeType: string;
  extension: string;
  durationMs: number;
  /** 0-100 amplitude peaks, roughly one per 100ms of audio. */
  waveform: number[];
};

export type RecorderStatus = "idle" | "starting" | "recording" | "finishing";

/** Peaks are sampled at this cadence and stored at the same resolution. */
const SAMPLE_INTERVAL_MS = 100;

/** Below this, the press reads as a mis-tap rather than an intent to record. */
export const MIN_RECORDING_MS = 700;

/** WhatsApp caps voice notes; an unbounded recorder is a memory leak with a UI. */
export const MAX_RECORDING_MS = 5 * 60 * 1000;

/**
 * Ordered by preference, not by popularity: Opus first because it is
 * dramatically smaller than AAC at speech bitrates, then the WebKit containers.
 * An empty string is a legitimate answer — it tells `MediaRecorder` to pick its
 * own default, which is correct on browsers whose `isTypeSupported` lies.
 */
const CANDIDATE_MIME_TYPES = [
  "audio/webm;codecs=opus",
  "audio/ogg;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/aac",
];

export function pickRecorderMimeType(): string {
  if (typeof MediaRecorder === "undefined") return "";
  for (const type of CANDIDATE_MIME_TYPES) {
    try {
      if (MediaRecorder.isTypeSupported(type)) return type;
    } catch {
      // Safari has historically thrown here rather than returning false.
    }
  }
  return "";
}

export function extensionForMime(mimeType: string): string {
  const base = mimeType.split(";")[0].trim().toLowerCase();
  switch (base) {
    case "audio/webm": return "webm";
    case "audio/ogg": return "ogg";
    case "audio/mp4": return "m4a";
    case "audio/aac": return "aac";
    case "audio/mpeg": return "mp3";
    case "audio/wav":
    case "audio/x-wav": return "wav";
    default: return "webm";
  }
}

function describeCaptureError(error: unknown): string {
  const name = (error as { name?: string } | null)?.name;
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return "Microphone access was blocked. Allow it in your settings to send voice notes.";
    case "NotFoundError":
    case "OverconstrainedError":
      return "No microphone found on this device.";
    case "NotReadableError":
      return "Your microphone is being used by another app.";
    default:
      return "Couldn't start recording. Please try again.";
  }
}

type UseVoiceRecorderOptions = {
  /** Fired when the recorder stops itself at MAX_RECORDING_MS. */
  onAutoStop?: (recording: VoiceRecording) => void;
};

export function useVoiceRecorder({ onAutoStop }: UseVoiceRecorderOptions = {}) {
  const [status, setStatus] = useState<RecorderStatus>("idle");
  const [elapsedMs, setElapsedMs] = useState(0);
  const [peaks, setPeaks] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const peaksRef = useRef<number[]>([]);
  const startedAtRef = useRef(0);

  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const sampleTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const tickTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /** Resolves the promise handed back by `stop()`, from inside `onstop`. */
  const settleRef = useRef<((recording: VoiceRecording | null) => void) | null>(null);
  const discardRef = useRef(false);
  const onAutoStopRef = useRef(onAutoStop);
  useEffect(() => { onAutoStopRef.current = onAutoStop; }, [onAutoStop]);

  const teardown = useCallback(() => {
    if (sampleTimerRef.current) { clearInterval(sampleTimerRef.current); sampleTimerRef.current = null; }
    if (tickTimerRef.current) { clearInterval(tickTimerRef.current); tickTimerRef.current = null; }

    try { sourceRef.current?.disconnect(); } catch { /* already torn down */ }
    sourceRef.current = null;
    analyserRef.current = null;

    const context = audioContextRef.current;
    audioContextRef.current = null;
    if (context && context.state !== "closed") void context.close().catch(() => {});

    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    recorderRef.current = null;
  }, []);

  useEffect(() => teardown, [teardown]);

  const start = useCallback(async (): Promise<boolean> => {
    if (status !== "idle") return false;
    setError(null);

    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setError("Voice notes aren't supported on this browser.");
      return false;
    }
    if (typeof MediaRecorder === "undefined") {
      setError("Voice notes aren't supported on this browser.");
      return false;
    }

    setStatus("starting");
    let stream: MediaStream;
    try {
      /* Echo cancellation and noise suppression are the difference between a
         voice note and a room recording, and every engine that implements them
         does so far more cheaply than anything we could run afterwards. */
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch (captureError) {
      setStatus("idle");
      setError(describeCaptureError(captureError));
      return false;
    }

    let recorder: MediaRecorder;
    try {
      const mimeType = pickRecorderMimeType();
      recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    } catch {
      /* A browser can support a type for `isTypeSupported` and still refuse it
         in the constructor. Falling back to the default is strictly better than
         failing the recording. */
      try {
        recorder = new MediaRecorder(stream);
      } catch {
        stream.getTracks().forEach((track) => track.stop());
        setStatus("idle");
        setError("Voice notes aren't supported on this browser.");
        return false;
      }
    }

    streamRef.current = stream;
    recorderRef.current = recorder;
    chunksRef.current = [];
    peaksRef.current = [];
    discardRef.current = false;
    startedAtRef.current = Date.now();

    setPeaks([]);
    setElapsedMs(0);

    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) chunksRef.current.push(event.data);
    };

    recorder.onstop = () => {
      const durationMs = Date.now() - startedAtRef.current;
      /* `recorder.mimeType` is the container the browser actually produced.
         Reading it before teardown matters — the recorder reference is cleared
         there. */
      const mimeType = recorder.mimeType || "audio/webm";
      const blob = new Blob(chunksRef.current, { type: mimeType });
      chunksRef.current = [];

      const capturedPeaks = peaksRef.current.slice();
      teardown();
      setStatus("idle");
      setElapsedMs(0);
      setPeaks([]);

      const settle = settleRef.current;
      settleRef.current = null;

      if (discardRef.current) {
        settle?.(null);
        return;
      }

      const recording: VoiceRecording = {
        blob,
        mimeType,
        extension: extensionForMime(mimeType),
        durationMs,
        waveform: capturedPeaks,
      };

      if (settle) settle(recording);
      else onAutoStopRef.current?.(recording);
    };

    try {
      /* A timeslice makes the recorder flush periodically instead of holding
         everything until stop — it bounds memory on a long note and means a
         crash mid-recording loses a second, not the whole clip. */
      recorder.start(250);
    } catch {
      teardown();
      setStatus("idle");
      setError("Couldn't start recording. Please try again.");
      return false;
    }

    /* Amplitude metering. `fftSize` is the smallest the spec allows: we want a
       loudness envelope, not a spectrum, so the extra bins would be discarded
       work at 10Hz for the whole recording. */
    try {
      const AudioContextCtor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (AudioContextCtor) {
        const context = new AudioContextCtor();
        const analyser = context.createAnalyser();
        analyser.fftSize = 32;
        const source = context.createMediaStreamSource(stream);
        source.connect(analyser);

        audioContextRef.current = context;
        analyserRef.current = analyser;
        sourceRef.current = source;

        const buffer = new Uint8Array(analyser.frequencyBinCount);
        sampleTimerRef.current = setInterval(() => {
          const node = analyserRef.current;
          if (!node) return;
          node.getByteTimeDomainData(buffer);

          /* Peak deviation from the 128 midpoint, scaled so ordinary speech
             lands around two thirds height rather than hugging the floor. */
          let peak = 0;
          for (let i = 0; i < buffer.length; i += 1) {
            const deviation = Math.abs(buffer[i] - 128);
            if (deviation > peak) peak = deviation;
          }
          const level = Math.max(6, Math.min(100, Math.round((peak / 128) * 190)));
          peaksRef.current.push(level);
          setPeaks(peaksRef.current.slice(-48));
        }, SAMPLE_INTERVAL_MS);
      }
    } catch {
      /* Metering is decoration. A recording without a waveform is still a
         recording, so a failure here must not fail the capture. */
    }

    tickTimerRef.current = setInterval(() => {
      const elapsed = Date.now() - startedAtRef.current;
      setElapsedMs(elapsed);
      if (elapsed >= MAX_RECORDING_MS && recorderRef.current?.state === "recording") {
        setStatus("finishing");
        recorderRef.current.stop();
      }
    }, 200);

    setStatus("recording");
    return true;
  }, [status, teardown]);

  /** Stops and resolves with the recording, or `null` if it was discarded. */
  const stop = useCallback((): Promise<VoiceRecording | null> => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") {
      teardown();
      setStatus("idle");
      return Promise.resolve(null);
    }
    setStatus("finishing");
    return new Promise((resolve) => {
      settleRef.current = resolve;
      try {
        recorder.stop();
      } catch {
        settleRef.current = null;
        teardown();
        setStatus("idle");
        resolve(null);
      }
    });
  }, [teardown]);

  const cancel = useCallback(() => {
    discardRef.current = true;
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") {
      teardown();
      setStatus("idle");
      setElapsedMs(0);
      setPeaks([]);
      return;
    }
    try {
      recorder.stop();
    } catch {
      teardown();
      setStatus("idle");
    }
  }, [teardown]);

  const clearError = useCallback(() => setError(null), []);

  return {
    status,
    isRecording: status === "recording" || status === "finishing",
    elapsedMs,
    peaks,
    error,
    clearError,
    start,
    stop,
    cancel,
  };
}

export default useVoiceRecorder;
