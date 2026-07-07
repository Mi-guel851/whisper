type WindowWithLegacyAudio = Window & {
  webkitAudioContext?: typeof AudioContext;
};

export function playNotificationSound() {
  if (typeof window === "undefined") return;

  try {
    const AudioCtx =
      window.AudioContext || (window as WindowWithLegacyAudio).webkitAudioContext;
    if (!AudioCtx) return;

    const ctx = new AudioCtx();

    const now = ctx.currentTime;

    function tone(freq: number, start: number, duration: number, gain: number) {
      const osc = ctx.createOscillator();
      const gainNode = ctx.createGain();

      osc.type = "sine";
      osc.frequency.value = freq;

      gainNode.gain.setValueAtTime(0, now + start);
      gainNode.gain.linearRampToValueAtTime(gain, now + start + 0.02);
      gainNode.gain.exponentialRampToValueAtTime(0.001, now + start + duration);

      osc.connect(gainNode);
      gainNode.connect(ctx.destination);

      osc.start(now + start);
      osc.stop(now + start + duration + 0.05);
    }

    // pleasant two-note "ding-dong" chime
    tone(880, 0, 0.25, 0.25);
    tone(1108.73, 0.12, 0.3, 0.2);

    setTimeout(() => ctx.close(), 800);
  } catch {
    // Web Audio blocked or unavailable — fail silently
  }
}
