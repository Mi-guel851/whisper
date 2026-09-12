/**
 * The entry point.
 *
 * `react-native-gesture-handler` MUST be imported before anything else — it
 * patches the touch system before any component mounts, and the router's own
 * entry does not import it. `expo-router/entry` is imported as a side effect:
 * evaluating it registers the root component that renders the `app/` route
 * tree. This file is wired up as the app's `main` in package.json.
 */
import "react-native-gesture-handler";
import "expo-router/entry";
