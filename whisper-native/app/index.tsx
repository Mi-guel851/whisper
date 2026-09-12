import { Redirect } from "expo-router";
import { useEffect, useState } from "react";

import { LoadingScreen } from "@/components/Screen";
import { Background } from "@/components/Background";
import { isProfileComplete } from "@/lib/profile";
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
 *
 * THE THIRD BRANCH, AND WHY IT HAS TO LIVE HERE
 *
 * An account whose profile step is unfinished — no username, no country, no
 * recovery phrase, `profile_completed` still false — cannot message anyone:
 * the database's own trigger refuses those rows, and forgot-password would
 * have nothing to verify. This is the app's single chokepoint for that gate,
 * the same job the web's `/complete-profile` redirect does at sign-in: every
 * signed-in entry (app open, deep link, confirmation-link return) passes
 * through here exactly once, so the check cannot be forgotten somewhere it
 * matters. `settings` re-checks defensively, but this fork is the gate.
 */
export default function Index() {
  const { session, userId, loading } = useSession();
  const [profileCheck, setProfileCheck] = useState<"checking" | "complete" | "incomplete">("checking");

  useEffect(() => {
    let alive = true;

    async function check() {
      if (!userId) {
        setProfileCheck("checking");
        return;
      }
      const complete = await isProfileComplete(userId);
      if (alive) setProfileCheck(complete ? "complete" : "incomplete");
    }

    void check();
    return () => {
      alive = false;
    };
  }, [userId]);

  if (loading || (session && profileCheck === "checking")) {
    return (
      <View style={styles.root}>
        <Background />
        <LoadingScreen label="Whisper" />
      </View>
    );
  }

  if (session) {
    if (profileCheck === "incomplete") {
      return <Redirect href="/complete-profile" />;
    }
    return <Redirect href="/(tabs)/feed" />;
  }

  return <Redirect href="/(auth)/login" />;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.background },
});
