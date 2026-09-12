/**
 * Babel config for the Whisper native app.
 *
 * LOAD ORDER IS NOT ARBITRARY
 *
 *  1. `babel-preset-expo` with `jsxImportSource: "nativewind"` — this is what
 *     lets `className` mean anything on a React Native component. Without the
 *     jsx import source, every `className` prop is silently dropped and the app
 *     renders unstyled.
 *  2. `nativewind/babel` — compiles the Tailwind classes written in
 *     `global.css`/`className` into StyleSheet objects.
 *  3. `react-native-reanimated/plugin` — MUST be last. Reanimated's plugin
 *     rewrites the worklet functions the animations descend into, and it has to
 *     see the output of the two above. Anything after it in this list will not
 *     be transformed correctly.
 */
module.exports = function (api) {
  api.cache(true);

  return {
    presets: [
      ["babel-preset-expo", { jsxImportSource: "nativewind" }],
      "nativewind/babel",
    ],
    plugins: [
      // Kept last on purpose — see the note above.
      "react-native-reanimated/plugin",
    ],
  };
};
