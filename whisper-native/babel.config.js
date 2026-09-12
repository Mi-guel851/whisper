/**
 * Babel config for the Whisper native app (expo-router version).
 *
 * Plugin order matters:
 *  1. babel-preset-expo (with nativewind jsxImportSource)
 *  2. nativewind/babel
 *  3. expo-router/babel plugin
 *  4. react-native-reanimated/plugin (MUST be last)
 */
module.exports = function (api) {
  api.cache(true);

  return {
    presets: [
      ["babel-preset-expo", { jsxImportSource: "nativewind" }],
      "nativewind/babel",
    ],
    plugins: [
      "expo-router/babel",
      // Kept last on purpose — Reanimated's plugin must see compiled output.
      "react-native-reanimated/plugin",
    ],
  };
};
