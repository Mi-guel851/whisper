import { Redirect } from "expo-router";

import { LoadingScreen } from "@/components/Screen";
import { Background } from "@/components/Background";
import { useSession } from "@/lib/session";
import { COLORS } from "@/lib/theme";
import { StyleSheet, View } from "react-native";

/**
 * The fork.
 *
 * The only job of this route is to send the app to the right home: a session
 * lands on the feed, no session lands on login. The session read has already
 * started in the root layout — by the time this mounts it is usually
 * resolved, so the fork is invisible rather than a spinner.
 *
 * `Redirect` rather than an effect-driven `router.replace`: the declarative
 * form cannot double-fire, and a redirect that fires twice is how a back
 * gesture lands on a screen that should have been replaced.
 */
export default function Index() {
  const { session, loading } = useSession();

  if (loading) {
    return (
      <View style={styles.root}>
        <Background />
        <LoadingScreen label="Whisper" />
      </View>
    );
  }

  if (session) {
    return <Redirect href="/(tabs)/feed" />;
  }

  return <Redirect href="/(auth)/login" />;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.background },
});
