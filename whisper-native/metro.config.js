const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");

/**
 * Standard Expo metro config, wrapped so NativeWind can compile `global.css`.
 * Also configured for expo-router.
 */
const config = getDefaultConfig(__dirname);

module.exports = withNativeWind(config, { input: "./global.css" });
