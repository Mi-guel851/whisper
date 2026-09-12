import { Redirect } from "expo-router";
import { View } from "react-native";

import { LoadingScreen } from "@/components/Screen";
import { useSession } from "@/lib/session";

/**
 * Index route.
 *
 * The root layout's guard handles redirection once the session is known. While
 * the session is loading we show a branded spinner, and once resolved the
 * guard pushes us to either login or feed.
 */
export default function Index() {
  const { session, loading } = useSession();

  if (loading) {
    return <LoadingScreen label="Whisper" />;
  }

  if (session) {
    return <Redirect href="/(tabs)/feed" />;
  }

  return <Redirect href="/(auth)/login" />;
}
