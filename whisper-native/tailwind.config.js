/**
 * Tailwind config for NativeWind.
 *
 * The palette is the app's design system, named once here so a screen never
 * hardcodes a hex value: `#0a0814` is the background everywhere (no white
 * screens, no light surfaces), the cyan→purple pair is the only accent
 * gradient, and `slate-400` (#94a3b8) is the muted text colour.
 *
 * `content` must list every directory that can contain a className. A file
 * outside this list has its classes stripped from the compiled sheet, which
 * looks exactly like a typo in the class name.
 */
module.exports = {
  content: [
    "./App.tsx",
    "./index.ts",
    "./lib/**/*.{js,jsx,ts,tsx}",
    "./components/**/*.{js,jsx,ts,tsx}",
    "./screens/**/*.{js,jsx,ts,tsx}",
    "./navigation/**/*.{js,jsx,ts,tsx}",
  ],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        /** Deep dark purple-black. The background of every screen. */
        whisper: {
          bg: "#0a0814",
          surface: "#120e20",
          card: "#17122a",
          border: "#2a2340",
        },
        /** Primary gradient stops, left to right. */
        brand: {
          cyan: "#22d3ee",
          purple: "#a855f7",
        },
        /** Body copy / secondary labels. */
        muted: "#94a3b8",
      },
      borderRadius: {
        "4xl": "28px",
        "5xl": "36px",
      },
    },
  },
  plugins: [],
};
