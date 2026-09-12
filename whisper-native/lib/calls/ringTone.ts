import { Audio } from "expo-av";

/**
 * The in-app ring tone, both directions: the caller hears it while ringing
 * out, the callee hears it while the overlay is up.
 *
 * A port of the web app's `lib/calls/ringTone.ts` — the same sound, because a
 * ring is identity: the web synthesises two sine partials (440 + 480 Hz) in
 * the classic one-on-two-off cadence at gain 0.16. React Native has no
 * WebAudio, so the burst is a 16-bit WAV synthesised offline to that exact
 * spec (`assets/sounds/ring-burst.wav` — 8kHz mono, 1s, 30ms attack / 80ms
 * release, matching `playBurst` sample for sample within its resolution), and
 * the cadence (1s on / 2s off) is the same `setInterval` the web module keeps.
 *
 * The web module's caveat survives in spirit: a sound that cannot start must
 * never crash its caller. Every failure here is silent — the vibration loop,
 * driven separately by the session engine, still guarantees the ring is felt.
 */

const BURST_ON_MS = 1_000;
const BURST_OFF_MS = 2_000;

type AudioSound = InstanceType<typeof Audio.Sound>;

let sound: AudioSound | null = null;
let burstTimer: ReturnType<typeof setInterval> | null = null;
let started = false;
let prepared: Promise<void> | null = null;

async function prepare(): Promise<void> {
  if (prepared) return prepared;

  prepared = (async () => {
    try {
      await Audio.setAudioModeAsync({
        playsInSilentModeIOS: true,
        staysActiveInBackground: false,
        shouldDuckAndroid: true,
      });
    } catch {
      /* Mode is best-effort; the burst itself is what matters. */
    }

    const { sound: loaded } = await Audio.Sound.createAsync(
      // The asset is bundled; require keeps Metro's asset pipeline happy.
      require("../../assets/sounds/ring-burst.wav"),
      { volume: 1, isLooping: false, shouldPlay: false },
      undefined,
      false
    );
    sound = loaded;
  })();

  return prepared;
}

async function playBurst(): Promise<void> {
  const current = sound;
  if (!current) return;
  try {
    await current.setPositionAsync(0);
    await current.playAsync();
  } catch {
    /* A refused burst is silent, not broken — see the module note. */
  }
}

/** Starts the ring. Idempotent — a second start before a stop is a no-op. */
export function startRingTone(): boolean {
  if (started) return started;

  started = true;
  void prepare()
    .then(() => {
      /* First burst immediately (a ring that waits a second to start reads as
         broken), then the cadence. */
      void playBurst();
      burstTimer = setInterval(() => {
        void playBurst();
      }, BURST_ON_MS + BURST_OFF_MS);
    })
    .catch(() => {
      started = false;
    });

  return true;
}

/** Stops the ring and releases the player. Safe to call when not ringing. */
export function stopRingTone() {
  if (burstTimer) {
    clearInterval(burstTimer);
    burstTimer = null;
  }
  if (sound) {
    void sound.stopAsync().catch(() => {});
    void sound.unloadAsync().catch(() => {});
    sound = null;
  }
  prepared = null;
  started = false;
}
