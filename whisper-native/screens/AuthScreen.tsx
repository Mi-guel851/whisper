import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Ionicons } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import { useEffect, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Background } from "@/components/Background";
import { GradientButton } from "@/components/GradientButton";
import { GradientText } from "@/components/GradientText";
import { GhostMark } from "@/components/Logo";
import { Field } from "@/components/Input";
import { isMissingSchema, safeErrorMessage } from "@/lib/errors";
import { vibrate } from "@/lib/haptics";
import { completeProfile, fetchProfile, validateUsername } from "@/lib/profile";
import { hasSupabaseConfig, supabase } from "@/lib/supabase";
import { useToast } from "@/lib/toast";
import { COLORS, GLASS, RADIUS } from "@/lib/theme";
import type { AuthStackParamList } from "@/navigation/types";

type Props = NativeStackScreenProps<AuthStackParamList, "Auth">;
type Mode = "login" | "signup";

/** Shown when the build has no Supabase project — the one error the app can fix
 *  by itself, so it names the fix. */
const CONFIG_ERROR =
  "This build has no backend configured. Put EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY in whisper-native/.env, then restart with `npx expo start --clear`.";

/**
 * Sign in and sign up, on one screen.
 *
 * The web app has `/login` and `/signup` as separate routes. On a phone they
 * are one screen with a two-position switch, because the forms differ by a
 * single field and a navigation between them costs a screen transition to show
 * the same thing.
 *
 * The switch is a sliding gradient indicator rather than two toggling buttons —
 * it says "these are two positions of one control", which is what stops people
 * from filling in the wrong form. When the mode changes, the extra field slides
 * in and the error clears.
 *
 * WHAT SIGNUP ACTUALLY DOES
 *
 * `auth.signUp` creates the auth user, and the `handle_new_user` trigger writes
 * the matching `profiles` row. The app does not write to `profiles` on this
 * screen — a second client-side insert would race the trigger and fail on the
 * primary key about half the time. If email confirmation is switched on, there
 * is no session yet and the screen says so instead of pretending to sign in.
 *
 * The username is only collected at signup because the profile row needs one and
 * the trigger may not have it: it is passed in the signup metadata as
 * `username`, which is where the trigger looks for it.
 */
export function AuthScreen({ navigation, route }: Props) {
  const insets = useSafeAreaInsets();
  const { showToast } = useToast();

  const [mode, setMode] = useState<Mode>(route.params?.mode ?? "login");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const indicator = useSharedValue(mode === "login" ? 0 : 1);

  useEffect(() => {
    indicator.value = withTiming(mode === "login" ? 0 : 1, {
      duration: 220,
      easing: Easing.out(Easing.cubic),
    });
  }, [indicator, mode]);

  const indicatorStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: indicator.value * 100 }],
  }));

  const switchMode = (next: Mode) => {
    if (next === mode) return;
    vibrate("select");
    setMode(next);
    setError(null);
    setNotice(null);
  };

  const submit = async () => {
    const trimmedEmail = email.trim().toLowerCase();
    const trimmedUsername = username.trim().toLowerCase();

    setError(null);
    setNotice(null);

    /* Nothing on this screen can work without a project to talk to, and the
       failure without this check is a request to localhost that reads like a
       bug in the app rather than a missing line in `.env`. */
    if (!hasSupabaseConfig) {
      setError(CONFIG_ERROR);
      return;
    }

    if (!trimmedEmail || !trimmedEmail.includes("@")) {
      setError("Enter a valid email address.");
      return;
    }
    if (password.length < 6) {
      setError("Passwords are at least 6 characters.");
      return;
    }

    if (mode === "signup") {
      const usernameError = validateUsername(trimmedUsername);
      if (usernameError) {
        setError(usernameError);
        return;
      }
    }

    setBusy(true);

    try {
      if (mode === "login") {
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
        /* The root navigator reacts to `onAuthStateChange`; nothing here
           navigates. Two navigators racing to the same destination is how a
           sign-in ends up pushing the feed twice. */
        return;
      }

      const { data, error: signUpError } = await supabase.auth.signUp({
        email: trimmedEmail,
        password,
        options: {
          data: { username: trimmedUsername },
          emailRedirectTo: process.env.EXPO_PUBLIC_SITE_URL
            ? `${process.env.EXPO_PUBLIC_SITE_URL}/dashboard`
            : undefined,
        },
      });

      if (signUpError) {
        setError(friendlyAuthError(signUpError.message));
        vibrate("warning");
        return;
      }

      vibrate("success");

      /* No session means email confirmation is on. Say so — a "welcome" toast
         over a form that is still there is the confusing part of most apps'
         first run. */
      if (!data.session) {
        setNotice(`We sent a confirmation link to ${trimmedEmail}. Open it, then sign in.`);
        setMode("login");
        setPassword("");
        return;
      }

      /* The trigger writes the profile; if it did not (an older database), fill
         the username in now so the user is not sent to a completed-profile flow
         for a field they already typed. */
      const profile = await fetchProfile(data.user?.id ?? "");
      if (profile && !profile.username) {
        try {
          await completeProfile(profile.id, trimmedUsername, trimmedUsername);
        } catch (cause) {
          if (!isMissingSchema(cause as never)) {
            console.warn("[auth] could not backfill the username:", cause);
          }
        }
      }
    } catch (cause) {
      setError(safeErrorMessage(cause, "Something went wrong. Try again."));
    } finally {
      setBusy(false);
    }
  };

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
          <View style={styles.brand}>
            <LinearGradient
              colors={["rgba(34,211,238,0.2)", "rgba(168,85,247,0.2)"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.brandMark}
            >
              <GhostMark size={46} />
            </LinearGradient>

            <GradientText style={styles.wordmark}>Whisper</GradientText>
            <Text style={styles.sub}>Anonymous messaging, on your phone.</Text>
          </View>

          {!hasSupabaseConfig && (
            <View style={[styles.banner, styles.bannerWarn, styles.bannerTop]}>
              <Ionicons name="construct-outline" size={16} color={COLORS.warning} />
              <Text style={styles.bannerWarnText}>{CONFIG_ERROR}</Text>
            </View>
          )}

          <BlurView intensity={GLASS.blurIntensity} tint="dark" style={styles.card}>
            <View style={styles.cardInner}>
              {/* The switch */}
              <View style={styles.switch}>
                <Animated.View style={[styles.switchIndicator, indicatorStyle]}>
                  <LinearGradient
                    colors={["#22d3ee", "#a855f7"]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={StyleSheet.absoluteFill}
                  />
                </Animated.View>

                {(["login", "signup"] as Mode[]).map((value) => (
                  <Pressable
                    key={value}
                    style={styles.switchButton}
                    onPress={() => switchMode(value)}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: mode === value }}
                  >
                    <Text style={[styles.switchText, mode === value && styles.switchTextActive]}>
                      {value === "login" ? "Log in" : "Sign up"}
                    </Text>
                  </Pressable>
                ))}
              </View>

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

              {mode === "signup" && (
                <Field
                  label="Username"
                  icon="at-outline"
                  value={username}
                  onChangeText={(value) => {
                    setUsername(value);
                    setError(null);
                  }}
                  placeholder="yourwhispername"
                  autoComplete="username"
                  style={styles.field}
                />
              )}

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
                autoComplete={mode === "login" ? "password" : "off"}
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

              {notice ? (
                <View style={[styles.banner, styles.bannerInfo]}>
                  <Ionicons name="mail-open-outline" size={16} color={COLORS.cyan} />
                  <Text style={styles.bannerInfoText}>{notice}</Text>
                </View>
              ) : null}

              <GradientButton
                label={mode === "login" ? "Log in" : "Create account"}
                icon={mode === "login" ? "log-in-outline" : "person-add-outline"}
                size="lg"
                fullWidth
                loading={busy}
                disabled={busy}
                onPress={() => void submit()}
                style={styles.submit}
              />

              <Pressable
                onPress={() => switchMode(mode === "login" ? "signup" : "login")}
                style={styles.swap}
              >
                <Text style={styles.swapText}>
                  {mode === "login" ? "New here? Create an account" : "Already have an account? Log in"}
                </Text>
              </Pressable>
            </View>
          </BlurView>

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

  switch: {
    flexDirection: "row",
    height: 44,
    borderRadius: RADIUS.pill,
    backgroundColor: "rgba(255,255,255,0.05)",
    padding: 3,
    position: "relative",
    marginBottom: 4,
  },
  switchIndicator: {
    position: "absolute",
    top: 3,
    left: 3,
    bottom: 3,
    width: "50%",
    borderRadius: RADIUS.pill,
    overflow: "hidden",
  },
  switchButton: { flex: 1, alignItems: "center", justifyContent: "center" },
  switchText: { color: COLORS.muted, fontSize: 14, fontWeight: "700" },
  switchTextActive: { color: "#0a0814", fontWeight: "900" },

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
  bannerInfo: {
    backgroundColor: "rgba(34,211,238,0.1)",
    borderColor: "rgba(34,211,238,0.26)",
  },
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
  bannerInfoText: { color: COLORS.cyan, fontSize: 13, flexShrink: 1, lineHeight: 18 },

  submit: { marginTop: 4 },
  swap: { alignItems: "center", paddingVertical: 6 },
  swapText: { color: COLORS.muted, fontSize: 13, fontWeight: "600" },

  footnote: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "center", marginTop: 20 },
  footnoteText: { color: COLORS.subtle, fontSize: 12, fontWeight: "600" },
});
