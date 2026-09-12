import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Animated, { FadeInDown, FadeInUp } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Background } from "@/components/Background";
import { GradientButton } from "@/components/GradientButton";
import { GradientText } from "@/components/GradientText";
import { Field } from "@/components/Input";
import { apiBase } from "@/lib/feed";
import { vibrate } from "@/lib/haptics";
import { useToast } from "@/lib/toast";
import { COLORS, GLASS, RADIUS, useStyles } from "@/lib/theme";

/**
 * Reset password — the no-email path.
 *
 * The web app's `/forgot-password`, field for field: username, recovery phrase,
 * new password, confirm. The knowledge of (username, phrase) *is* the
 * credential, and the check happens server-side at `/api/reset-with-phrase` —
 * the same route the site posts to, with the same rate limits and the same
 * PBKDF2-verified phrase hash. The client never sees the hash and never
 * guesses; a wrong pair reads exactly like an unknown username.
 *
 * The password rules are the signup's: at least 8 characters here (the web
 * form's own check), and the two copies must match before a round trip is
 * spent on either.
 */
export default function ForgotPassword() {
  const styles = useStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const { showToast } = useToast();

  const [username, setUsername] = useState("");
  const [phrase, setPhrase] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    setError(null);

    const cleanUsername = username.trim().toLowerCase();
    if (!cleanUsername) {
      setError("Enter your username.");
      return;
    }
    if (!phrase.trim()) {
      setError("Enter your recovery phrase.");
      return;
    }
    if (newPassword.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Passwords don't match.");
      return;
    }

    setLoading(true);

    try {
      const res = await fetch(`${apiBase()}/api/reset-with-phrase`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: cleanUsername,
          phrase: phrase.trim(),
          newPassword,
        }),
      });

      const data = (await res.json().catch(() => ({}))) as { error?: string };

      if (!res.ok) {
        setError(data.error || "Something went wrong.");
        vibrate("warning");
        return;
      }

      vibrate("success");
      showToast("Password updated! You can now log in. 🔒", { variant: "success" });
      router.replace("/(auth)/login");
    } catch {
      setError("Can't reach the server. Check your connection.");
      vibrate("warning");
    } finally {
      setLoading(false);
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
            { paddingTop: insets.top + 30, paddingBottom: Math.max(insets.bottom, 24) + 24 },
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Pressable
            onPress={() => router.back()}
            style={styles.back}
            accessibilityRole="link"
            accessibilityLabel="Back"
          >
            <Ionicons name="chevron-back" size={16} color={COLORS.muted} />
            <Text style={styles.backText}>Back to login</Text>
          </Pressable>

          <Animated.View entering={FadeInDown.duration(420)} style={styles.brand}>
            <LinearGradient
              colors={["rgba(34,211,238,0.2)", "rgba(168,85,247,0.2)"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.badge}
            >
              <Ionicons name="key-outline" size={24} color={COLORS.cyan} />
            </LinearGradient>

            <GradientText style={styles.wordmark}>Reset password</GradientText>
            <Text style={styles.subtitle}>
              Enter your username and the recovery phrase you set when you signed up.
            </Text>
          </Animated.View>

          <Animated.View entering={FadeInUp.delay(80).duration(420)}>
            <View style={styles.card}>
              <View style={styles.cardInner}>
                <Field
                  label="Username"
                  icon="at-outline"
                  value={username}
                  onChangeText={(value) => {
                    setUsername(value);
                    setError(null);
                  }}
                  placeholder="yourname"
                  autoComplete="username"
                  autoCapitalize="none"
                  style={styles.field}
                />

                <Field
                  label="Recovery phrase"
                  icon="key-outline"
                  value={phrase}
                  onChangeText={(value) => {
                    setPhrase(value);
                    setError(null);
                  }}
                  placeholder="e.g. purple-ghost-echoes-42"
                  secureTextEntry={!showPassword}
                  style={styles.field}
                />

                <Field
                  label="New password"
                  icon="lock-closed-outline"
                  value={newPassword}
                  onChangeText={(value) => {
                    setNewPassword(value);
                    setError(null);
                  }}
                  placeholder="At least 8 characters"
                  secureTextEntry={!showPassword}
                  autoComplete="password"
                  style={styles.field}
                />

                <Field
                  label="Confirm new password"
                  icon="lock-closed-outline"
                  value={confirmPassword}
                  onChangeText={(value) => {
                    setConfirmPassword(value);
                    setError(null);
                  }}
                  placeholder="Repeat your new password"
                  secureTextEntry={!showPassword}
                  autoComplete="password"
                  style={styles.field}
                />

                <Pressable
                  onPress={() => setShowPassword((value) => !value)}
                  style={styles.reveal}
                  accessibilityLabel={showPassword ? "Hide passwords" : "Show passwords"}
                >
                  <Ionicons
                    name={showPassword ? "eye-off-outline" : "eye-outline"}
                    size={14}
                    color={COLORS.muted}
                  />
                  <Text style={styles.revealText}>{showPassword ? "Hide" : "Show"} passwords</Text>
                </Pressable>

                {error ? (
                  <View style={styles.banner}>
                    <Ionicons name="alert-circle" size={16} color={COLORS.danger} />
                    <Text style={styles.bannerError}>{error}</Text>
                  </View>
                ) : null}

                <GradientButton
                  label={loading ? "Resetting…" : "Reset password"}
                  icon="shield-checkmark-outline"
                  size="lg"
                  fullWidth
                  loading={loading}
                  disabled={loading}
                  onPress={() => void handleSubmit()}
                  style={styles.submit}
                />
              </View>
            </View>
          </Animated.View>

          <Text style={styles.footnote}>
            No recovery phrase? The website can email you a reset link instead.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const makeStyles = () => StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.background },
  flex: { flex: 1 },
  scroll: { paddingHorizontal: 22, flexGrow: 1, justifyContent: "center" },

  back: { flexDirection: "row", alignItems: "center", gap: 3, alignSelf: "flex-start", marginBottom: 18 },
  backText: { color: COLORS.muted, fontSize: 13, fontWeight: "700" },

  brand: { alignItems: "center", marginBottom: 26 },
  badge: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  wordmark: { fontSize: 26, fontWeight: "900", letterSpacing: -0.8, marginTop: 14 },
  subtitle: {
    color: COLORS.muted,
    fontSize: 13,
    fontWeight: "600",
    marginTop: 6,
    textAlign: "center",
    lineHeight: 19,
    paddingHorizontal: 12,
  },

  card: {
    borderRadius: RADIUS.xxl,
    borderWidth: 1,
    borderColor: GLASS.border,
    backgroundColor: "rgba(23,18,42,0.55)",
    overflow: "hidden",
  },
  cardInner: { padding: 18, gap: 12 },

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

  submit: { marginTop: 4 },
  footnote: {
    color: COLORS.subtle,
    fontSize: 12,
    textAlign: "center",
    marginTop: 18,
    lineHeight: 17,
    paddingHorizontal: 12,
  },
});
