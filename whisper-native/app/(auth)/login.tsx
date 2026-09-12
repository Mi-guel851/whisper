import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Animated, { Easing, FadeInDown, FadeInUp, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Background } from "@/components/Background";
import { GradientButton } from "@/components/GradientButton";
import { GradientText } from "@/components/GradientText";
import { GhostMark } from "@/components/Logo";
import { Field } from "@/components/Input";
import { isOnboarded } from "@/lib/firstRun";
import { safeErrorMessage } from "@/lib/errors";
import { vibrate } from "@/lib/haptics";
import { hasSupabaseConfig, supabase } from "@/lib/supabase";
import { useToast } from "@/lib/toast";
import { COLORS, GLASS, RADIUS } from "@/lib/theme";

/**
 * The CONFIG_ERROR copy lives once, next to the check that needs it.
 *
 * Nothing on this screen can work without a Supabase project, and the failure
 * without this check is a request to localhost that reads like a bug in the
 * app rather than a missing line in `.env`.
 */
const CONFIG_ERROR =
  "This build has no backend configured. Put EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY in whisper-native/.env, then restart with `npx expo start --clear`.";

/**
 * Login.
 *
 * The web app's `/login`, field for field: email, password, a "Forgot
 * password?" link, and `signInWithPassword`. The errors are inline rather than
 * toasted, because an auth error is about the form — it belongs next to it.
 *
 * FIRST RUN
 *
 * A user who has never seen the app is sent to the onboarding intro first, once
 * — the flag is read on mount and the redirect happens before the form paints.
 * Everyone else lands here directly, forever.
 *
 * AFTER THE SIGN-IN
 *
 * Nothing here navigates on success. The (auth) layout sees the session from
 * `onAuthStateChange` and redirects to the tabs; two navigators racing to the
 * same destination is how a sign-in ends up pushing the feed twice.
 */
export default function Login() {
  const insets = useSafeAreaInsets();
  const { showToast } = useToast();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* First-timers meet the intro before they meet this form. */
  useEffect(() => {
    let cancelled = false;
    void isOnboarded().then((seen) => {
      if (!cancelled && !seen) router.replace("/(auth)/onboarding");
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const submit = async () => {
    const trimmedEmail = email.trim().toLowerCase();

    setError(null);

    if (!hasSupabaseConfig) {
      setError(CONFIG_ERROR);
      return;
    }

    if (!trimmedEmail || !trimmedEmail.includes("@")) {
      setError("Enter a valid email address.");
      return;
    }
    if (!password) {
      setError("Enter your password.");
      return;
    }

    setBusy(true);

    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: trimmedEmail,
        password,
      });

      if (signInError) {
        setError(friendlyAuthError(signInError.message));
        vibrate("warning");
        return;
      }

      vibrate("success");
      showToast("Welcome back! 👋", { variant: "success" });
      /* The layout reacts to the session; nothing navigates here. */
    } catch (cause) {
      setError(safeErrorMessage(cause, "Something went wrong. Try again."));
    } finally {
      setBusy(false);
    }
  };

  const errorStyle = useAnimatedStyle(() => ({ opacity: error ? 1 : 0 }));

  return (
    <View style={styles.root}>
      <Background />

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={0}
      >
        <ScrollView
          contentContainerStyle={[
            styles.scroll,
            { paddingTop: insets.top + 40, paddingBottom: Math.max(insets.bottom, 24) + 24 },
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Animated.View entering={FadeInDown.duration(420).easing(Easing.out(Easing.cubic))} style={styles.brand}>
            <View style={styles.brandMark}>
              <GhostMark size={46} />
            </View>

            <GradientText style={styles.wordmark}>Whisper</GradientText>
            <Text style={styles.sub}>Welcome back</Text>
          </Animated.View>

          {!hasSupabaseConfig && (
            <View style={[styles.banner, styles.bannerWarn, styles.bannerTop]}>
              <Ionicons name="construct-outline" size={16} color={COLORS.warning} />
              <Text style={styles.bannerWarnText}>{CONFIG_ERROR}</Text>
            </View>
          )}

          <Animated.View entering={FadeInUp.delay(80).duration(420).easing(Easing.out(Easing.cubic))}>
            <View style={styles.card}>
              <View style={styles.cardInner}>
                <Text style={styles.title}>Log in</Text>
                <Text style={styles.subtitle}>Your whispers are waiting.</Text>

                <Field
                  label="Email"
                  icon="mail-outline"
                  value={email}
                  onChangeText={(value) => {
                    setEmail(value);
                    setError(null);
                  }}
                  placeholder="you@example.com"
                  keyboardType="email-address"
                  autoComplete="email"
                  style={styles.field}
                />

                <Field
                  label="Password"
                  icon="lock-closed-outline"
                  value={password}
                  onChangeText={(value) => {
                    setPassword(value);
                    setError(null);
                  }}
                  placeholder="••••••••"
                  secureTextEntry={!showPassword}
                  autoComplete="password"
                  style={styles.field}
                />

                <Pressable
                  onPress={() => setShowPassword((value) => !value)}
                  style={styles.reveal}
                  accessibilityLabel={showPassword ? "Hide password" : "Show password"}
                >
                  <Ionicons
                    name={showPassword ? "eye-off-outline" : "eye-outline"}
                    size={14}
                    color={COLORS.muted}
                  />
                  <Text style={styles.revealText}>{showPassword ? "Hide" : "Show"} password</Text>
                </Pressable>

                {error ? (
                  <View style={styles.banner}>
                    <Ionicons name="alert-circle" size={16} color={COLORS.danger} />
                    <Text style={styles.bannerError}>{error}</Text>
                  </View>
                ) : null}

                <GradientButton
                  label="Login"
                  icon="log-in-outline"
                  size="lg"
                  fullWidth
                  loading={busy}
                  disabled={busy}
                  onPress={() => void submit()}
                  style={styles.submit}
                />

                <Pressable
                  onPress={() => router.push("/forgot-password")}
                  style={styles.forgot}
                  accessibilityRole="link"
                  accessibilityLabel="Forgot password"
                >
                  <Text style={styles.forgotText}>Forgot password?</Text>
                </Pressable>

                <Pressable
                  onPress={() => router.push("/(auth)/signup")}
                  style={styles.swap}
                  accessibilityRole="link"
                >
                  <Text style={styles.swapText}>
                    New here? <Text style={styles.swapLink}>Create an account</Text>
                  </Text>
                </Pressable>
              </View>
            </View>
          </Animated.View>

          <Pressable
            onPress={() => {
              showToast("Anonymous by design — we never ask for your real name.", { variant: "subtle" });
            }}
            style={styles.footnote}
          >
            <Ionicons name="shield-checkmark-outline" size={14} color={COLORS.purple} />
            <Text style={styles.footnoteText}>Your email is never shown to anyone.</Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

/**
 * Auth failures worth a sentence rather than a code.
 *
 * Supabase is precise and unhelpful: "Invalid login credentials" is fine, but
 * "Email not confirmed" leaves people stuck, and a rate limit reads as a broken
 * app. Each of these says what to do next.
 */
function friendlyAuthError(message: string): string {
  const lower = message.toLowerCase();

  if (lower.includes("invalid login credentials")) return "That email and password don't match.";
  if (lower.includes("email not confirmed")) return "Confirm your email first — check your inbox for the link.";
  if (lower.includes("already registered") || lower.includes("already been registered")) {
    return "That email already has an account. Log in instead.";
  }
  if (lower.includes("rate limit") || lower.includes("too many")) {
    return "Too many attempts. Wait a minute and try again.";
  }
  if (lower.includes("weak password")) return "That password is too easy to guess.";
  if (lower.includes("failed to fetch") || lower.includes("network")) {
    return "Can't reach the server. Check your connection.";
  }

  return message;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.background },
  flex: { flex: 1 },
  scroll: { paddingHorizontal: 22, flexGrow: 1, justifyContent: "center" },

  brand: { alignItems: "center", marginBottom: 26 },
  brandMark: {
    width: 84,
    height: 84,
    borderRadius: 42,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(34,211,238,0.12)",
    borderWidth: 1,
    borderColor: "rgba(34,211,238,0.2)",
  },
  wordmark: { fontSize: 34, fontWeight: "900", letterSpacing: -1.2, marginTop: 14 },
  sub: { color: COLORS.muted, fontSize: 13.5, fontWeight: "600", marginTop: 6 },

  card: {
    borderRadius: RADIUS.xxl,
    borderWidth: 1,
    borderColor: GLASS.border,
    backgroundColor: "rgba(23,18,42,0.55)",
    overflow: "hidden",
  },
  cardInner: { padding: 18, gap: 12 },

  title: { color: COLORS.text, fontSize: 22, fontWeight: "900" },
  subtitle: { color: COLORS.muted, fontSize: 13, fontWeight: "600", marginTop: -8 },

  field: {},
  reveal: { flexDirection: "row", alignItems: "center", gap: 5, alignSelf: "flex-end", marginTop: -4 },
  revealText: { color: COLORS.muted, fontSize: 11.5, fontWeight: "700" },

  banner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    padding: 11,
    borderRadius: RADIUS.md,
    backgroundColor: "rgba(239,68,68,0.12)",
    borderWidth: 1,
    borderColor: "rgba(239,68,68,0.28)",
  },
  bannerError: { color: COLORS.danger, fontSize: 13, flexShrink: 1, lineHeight: 18 },
  bannerWarn: {
    borderColor: "rgba(245,158,11,0.32)",
    backgroundColor: "rgba(245,158,11,0.10)",
  },
  bannerWarnText: {
    flex: 1,
    color: COLORS.warning,
    fontSize: 12.5,
    lineHeight: 18,
  },
  bannerTop: { marginBottom: 16 },

  submit: { marginTop: 4 },
  forgot: { alignItems: "center", paddingVertical: 2 },
  forgotText: { color: COLORS.cyan, fontSize: 13, fontWeight: "700" },
  swap: { alignItems: "center", paddingVertical: 6 },
  swapText: { color: COLORS.muted, fontSize: 13, fontWeight: "600" },
  swapLink: { color: COLORS.cyan, fontWeight: "800" },

  footnote: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "center", marginTop: 20 },
  footnoteText: { color: COLORS.subtle, fontSize: 12, fontWeight: "600" },
});
