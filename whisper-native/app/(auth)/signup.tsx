import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Animated, { Easing, FadeInDown, FadeInUp } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Background } from "@/components/Background";
import { GradientButton } from "@/components/GradientButton";
import { GoogleButton } from "@/components/GoogleButton";
import { signInWithGoogle, SIGNUPS_CLOSED, SIGNUPS_OPEN } from "@/lib/googleAuth";
import { GradientText } from "@/components/GradientText";
import { GhostMark } from "@/components/Logo";
import { Field } from "@/components/Input";
import { markOnboarded } from "@/lib/firstRun";
import { isMissingSchema, safeErrorMessage } from "@/lib/errors";
import { vibrate } from "@/lib/haptics";
import { completeProfile, fetchProfile, validateUsername } from "@/lib/profile";
import { hasSupabaseConfig, supabase } from "@/lib/supabase";
import { COLORS, GLASS, RADIUS, useStyles } from "@/lib/theme";

/** Same copy as login's — the two auth screens share one truth about the build. */
const CONFIG_ERROR =
  "This build has no backend configured. Put EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY in whisper-native/.env, then restart with `npx expo start --clear`.";

/**
 * Sign up.
 *
 * `auth.signUp` creates the auth user, and the `handle_new_user` trigger writes
 * the matching `profiles` row. The app does not insert into `profiles` on this
 * screen — a second client-side insert would race the trigger and fail on the
 * primary key about half the time.
 *
 * THE USERNAME
 *
 * The profile row needs one and the trigger may not have it, so it is collected
 * here and passed in the signup metadata as `username` — which is where the
 * trigger looks. If the trigger did not run (an older database), the username
 * is backfilled right after the session exists so the user is never sent to a
 * completed-profile flow for a field they already typed.
 *
 * EMAIL CONFIRMATION
 *
 * With confirmation switched on there is no session after signUp, and the
 * screen says so instead of pretending to sign in: a "welcome" toast over a
 * form that is still there is the confusing part of most apps' first run.
 */
export default function Signup() {
  const styles = useStyles(makeStyles);
  const insets = useSafeAreaInsets();

  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const submit = async () => {
    const trimmedEmail = email.trim().toLowerCase();
    const trimmedUsername = username.trim().toLowerCase();

    setError(null);
    setNotice(null);

    if (!hasSupabaseConfig) {
      setError(CONFIG_ERROR);
      return;
    }

    if (!trimmedEmail || !trimmedEmail.includes("@")) {
      setError("Enter a valid email address.");
      return;
    }
    const usernameError = validateUsername(trimmedUsername);
    if (usernameError) {
      setError(usernameError);
      return;
    }
    if (password.length < 6) {
      setError("Passwords are at least 6 characters.");
      return;
    }

    setBusy(true);

    try {
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
      void markOnboarded();

      /* No session means email confirmation is on. Say so. */
      if (!data.session) {
        setNotice(`We sent a confirmation link to ${trimmedEmail}. Open it, then sign in.`);
        setPassword("");
        return;
      }

      /* The trigger writes the profile; if it did not (an older database), fill
         the username in now so onboarding never re-asks. */
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

      /* The session state change sends the user to the tabs. */
    } catch (cause) {
      setError(safeErrorMessage(cause, "Something went wrong. Try again."));
    } finally {
      setBusy(false);
    }
  }
  /* Google creates the account on first use — which is exactly why the
     button only exists while signups are open. */
  const onGoogle = async () => {
    setError(null);
    setGoogleBusy(true);
    const result = await signInWithGoogle();
    setGoogleBusy(false);
    if (result.cancelled) return;
    if ("error" in result && result.error) {
      setError(result.error);
      vibrate("warning");
      return;
    }
    vibrate("success");
    void markOnboarded();
    /* The session state change sends the user where they belong — a fresh
       account lands on complete-profile, same as the web's flow. */
  };
;

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
            <Text style={styles.sub}>Get your own Whisper link in seconds</Text>
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
                <Text style={styles.title}>Create account</Text>
                <Text style={styles.subtitle}>No name. No number. Just a whisper.</Text>

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
                  label="Username"
                  icon="at-outline"
                  value={username}
                  onChangeText={(value) => {
                    setUsername(value);
                    setError(null);
                  }}
                  placeholder="yourwhispername"
                  autoComplete="username"
                  autoCapitalize="none"
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

                {notice ? (
                  <View style={[styles.banner, styles.bannerInfo]}>
                    <Ionicons name="mail-open-outline" size={16} color={COLORS.cyan} />
                    <Text style={styles.bannerInfoText}>{notice}</Text>
                  </View>
                ) : null}

                <GradientButton
                  label="Sign Up"
                  icon="person-add-outline"
                  size="lg"
                  fullWidth
                  loading={busy}
                  disabled={busy || googleBusy}
                  onPress={() => void submit()}
                  style={styles.submit}
                />

                {SIGNUPS_OPEN ? (
                  <GoogleButton
                    loading={googleBusy}
                    disabled={busy}
                    onPress={() => void onGoogle()}
                    style={styles.googleButton}
                  />
                ) : null}

                <Text style={styles.terms}>
                  By continuing you agree to be kind. Whisper never posts as you and
                  never shows your email to anyone.
                </Text>

                <Pressable
                  onPress={() => router.push("/(auth)/login")}
                  style={styles.swap}
                  accessibilityRole="link"
                >
                  <Text style={styles.swapText}>
                    Already have an account? <Text style={styles.swapLink}>Log in</Text>
                  </Text>
                </Pressable>
              </View>
            </View>
          </Animated.View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

/** The same translations login uses — two auth screens, one voice. */
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

const makeStyles = () => StyleSheet.create({
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
  googleButton: { marginTop: 12 },
  terms: { color: COLORS.subtle, fontSize: 11, lineHeight: 16, textAlign: "center", paddingHorizontal: 6 },
  swap: { alignItems: "center", paddingVertical: 6 },
  swapText: { color: COLORS.muted, fontSize: 13, fontWeight: "600" },
  swapLink: { color: COLORS.cyan, fontWeight: "800" },
});
