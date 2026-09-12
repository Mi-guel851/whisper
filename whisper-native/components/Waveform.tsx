import { StyleSheet, View } from "react-native";

import { COLORS, useStyles } from "@/lib/theme";

/**
 * A voice note's waveform.
 *
 * Played bars are filled with the brand cyan and the rest sit in a muted grey,
 * so the bar row is also the progress indicator — the same thing the web app's
 * `VoicePlayer` does, and the reason a voice bubble needs no separate scrubber.
 *
 * The bars are drawn from the 0–100 amplitude array stored with the message, so
 * a recording made on a phone and played on the web shows the same shape, and
 * neither client has to decode the file to draw it.
 */
export function Waveform({
  peaks,
  progress = 0,
  bars = 34,
  height = 28,
  color = COLORS.cyan,
  inactiveColor = "rgba(255,255,255,0.22)",
}: {
  peaks: number[];
  /** 0–1 playback position. */
  progress?: number;
  bars?: number;
  height?: number;
  color?: string;
  inactiveColor?: string;
}) {
  const styles = useStyles(makeStyles);
  const samples = normalize(peaks, bars);
  const playedUpTo = Math.floor(progress * samples.length);

  return (
    <View style={[styles.row, { height }]}>
      {samples.map((sample, index) => {
        const active = index <= playedUpTo;
        const barHeight = Math.max(3, (sample / 100) * height);

        return (
          <View
            key={index}
            style={{
              width: 2.5,
              height: barHeight,
              borderRadius: 2,
              backgroundColor: active ? color : inactiveColor,
            }}
          />
        );
      })}
    </View>
  );
}

/**
 * Resamples an arbitrary-length peak array to exactly `bars` values.
 *
 * Averaging, not every-Nth: a 5-minute note recorded at 10 samples/sec holds
 * 3000 peaks, and stepping through them would draw a waveform that is really a
 * sample of the audio rather than its shape. Averaging keeps the envelope.
 */
function normalize(peaks: number[], bars: number): number[] {
  if (peaks.length === 0) return new Array(bars).fill(12);
  if (peaks.length === bars) return peaks;

  const output: number[] = [];
  const step = peaks.length / bars;

  for (let index = 0; index < bars; index += 1) {
    const start = Math.floor(index * step);
    const end = Math.max(start + 1, Math.floor((index + 1) * step));
    let total = 0;
    for (let cursor = start; cursor < end && cursor < peaks.length; cursor += 1) {
      total += peaks[cursor];
    }
    output.push(Math.round(total / (end - start)));
  }

  return output;
}

const makeStyles = () => StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 2 },
});
