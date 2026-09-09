/**
 * The in-app ring tone, both directions: the caller hears it while ringing
 * out, the callee hears it while the overlay is up.
 *
 * Web Audio, no audio file: two sine partials (440 + 480 Hz) in the classic
 * one-on-two-off cadence, generated per burst. A file would be ~100KB of
 * bundle for a sound that is four numbers — and lib/sound.ts already
 * established the pattern (and the fallback: Web Audio unavailable means the
 * ring is simply silent; the vibration, which the caller passes separately,
 * still does its job).
 *
 * THE CAVEAT THIS EXISTS TO SURVIVE
 *
 * An incoming call has no user gesture: the browser's autoplay policy keeps
 * an AudioContext suspended until the page has had some interaction. In the
 * Capacitor shell the user has always interacted (that is how they are in
 * the app), but a fresh WebView tab may not have. So start() tries to
 * resume(), and if the context stays suspended it stops quietly — the
 * vibration loop (driven by the caller, via the haptics module) is what
 * guarantees the ring is felt, and an app that vibrates but doesn't buzz is
 * a better miss than one that crashes its caller.
 */

type WindowWithLegacyAudio = Window & {
  webkitAudioContext?: typeof AudioContext;
};

let ctx: AudioContext | null = null;
let burstTimer: ReturnType<typeof setInterval> | null = null;
let started = false;

const BURST_ON_MS = 1_000;
const BURST_OFF_MS = 2_000;
const GAIN = 0.16;

function playBurst(audio: AudioContext) {
  const now = audio.currentTime;
  const duration = BURST_ON_MS / 1000;

  for (const freq of [440, 480]) {
    const osc = audio.createOscillator();
    const gainNode = audio.createGain();

    osc.type = "sine";
    osc.frequency.value = freq;

    gainNode.gain.setValueAtTime(0, now);
    gainNode.gain.linearRampToValueAtTime(GAIN, now + 0.03);
    gainNode.gain.setValueAtTime(GAIN, now + duration - 0.08);
    gainNode.gain.linearRampToValueAtTime(0.0001, now + duration);

    osc.connect(gainNode);
    gainNode.connect(audio.destination);
    osc.start(now);
    osc.stop(now + duration + 0.05);
  }
}

/** Starts the ring. Idempotent — a second start before a stop is a no-op. */
export function startRingTone(): boolean {
  if (started || typeof window === "undefined") return started;

  const AudioCtx = window.AudioContext || (window as WindowWithLegacyAudio).webkitAudioContext;
  if (!AudioCtx) return false;

  try {
    ctx = new AudioCtx();
  } catch {
    ctx = null;
    return false;
  }

  /* First burst immediately (a ring that waits a second to start reads as
     broken), then the cadence. */
  const begin = () => {
    if (ctx && ctx.state === "running") {
      playBurst(ctx);
      burstTimer = setInterval(() => {
        if (ctx && ctx.state === "running") playBurst(ctx);
      }, BURST_ON_MS + BURST_OFF_MS);
    }
  };

  if (ctx.state === "suspended") {
    /* Resume without awaiting: if the policy blocks it, the state stays
       "suspended" and begin() simply never arms — silent, not broken. */
    void ctx.resume().then(begin).catch(() => {});
    // Fallback: some engines resume asynchronously a tick later.
    setTimeout(begin, 150);
  } else {
    begin();
  }

  started = true;
  return true;
}

/** Stops the ring and releases the context. Safe to call when not ringing. */
export function stopRingTone() {
  if (burstTimer) {
    clearInterval(burstTimer);
    burstTimer = null;
  }
  if (ctx) {
    void ctx.close().catch(() => {});
    ctx = null;
  }
  started = false;
}
