/**
 * The entry point.
 *
 * `expo`/`registerRootComponent` rather than expo-router: this app uses React
 * Navigation, and the router's file-based setup would install a second
 * navigator that owns the root. The gesture handler import must come first —
 * it patches the touch system before any component mounts.
 */
import "react-native-gesture-handler";
import { registerRootComponent } from "expo";

import App from "./App";

registerRootComponent(App);
