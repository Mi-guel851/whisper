const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");

/**
 * Standard Expo metro config, wrapped so NativeWind can compile `global.css`.
 *
 * `input` points at the Tailwind entry sheet. If that file is missing or the
 * wrapper is removed, every className in the app resolves to nothing and the
 * screens render as unstyled views on a dark background — the fastest way to
 * mistake a config error for a layout bug.
 */
const config = getDefaultConfig(__dirname);

module.exports = withNativeWind(config, { input: "./global.css" });
