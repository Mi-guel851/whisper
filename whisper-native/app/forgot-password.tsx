import { Ionicons } from "@expo/vector-icons";
import { Link, router } from "expo-router";
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

import { Field } from "@/components/Input";
import { GradientButton } from "@/components/GradientButton";
import { GradientText } from "@/components/GradientText";
import { Background } from "@/components/Background";
import { supabase } from "@/lib/supabase";
import { COLORS } from "@/lib/theme";
import { useToast } from "@/lib/toast";

/**
 * Forgot Password.
 *
 * Because the recovery phrase flow depends on a server API route that expects a
 * browser cookie and is designed for web, this native version does the standard
 * Supabase reset-password-email flow: user enters their email, gets a reset
 * link, and returns to the app.
 */
export default function ForgotPasswordScreen() {
  const { showToast } = useToast();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleReset() {
    if (!email.trim()) {
      showToast("Enter your email.");
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: "whisper://reset-password",
    });
    setLoading(false);

    if (error) {
      showToast(error.message, { variant: "error" });
      return;
    }
    setSent(true);
    showToast("Reset link sent — check your email.", { variant: "success" });
  }

  return (
    <View style={styles.root}>
      <Background />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Pressable onPress={() => router.back()} style={styles.backRow}>
            <Ionicons name="chevron-back" size={18} color={COLORS.cyan} />
            <Text style={styles.backText}>Back to login</Text>
          </Pressable>

          <View style={styles.brand}>
            <View style={styles.badge}>
              <Ionicons name="key-outline" size={32} color={COLORS.cyan} />
            </View>
            <GradientText style={styles.title}>Reset Password</GradientText>
            <Text style={styles.helper}>
              Enter your email and we'll send you a link to reset your password.
            </Text>
          </View>

          {sent ? (
            <View style={styles.sentBox}>
              <Ionicons name="mail-outline" size={36} color={COLORS.cyan} />
              <Text style={styles.sentTitle}>Check your email</Text>
              <Text style={styles.sentBody}>
                We've sent a reset link to {email}. Follow the link to set a new password.
              </Text>
              <GradientButton label="Back to Login" onPress={() => router.replace("/(auth)/login")} />
            </View>
          ) : (
            <View style={styles.form}>
              <Field
                label="Email"
                icon="mail-outline"
                value={email}
                onChangeText={setEmail}
                placeholder="you@example.com"
                keyboardType="email-address"
                autoComplete="email"
                autoCapitalize="none"
                returnKeyType="done"
                onSubmitEditing={handleReset}
              />

              <View style={{ marginTop: 12 }}>
                <GradientButton
                  label={loading ? "Sending..." : "Send Reset Link"}
                  onPress={handleReset}
                  loading={loading}
                />
              </View>
            </View>
          )}

          <View style={styles.footer}>
            <Text style={styles.footnote}>
              Remembered it?{" "}
              <Text style={styles.link} onPress={() => router.back()}>
                Login
              </Text>
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.background },
  content: { flexGrow: 1, padding: 24, paddingTop: 64 },
  backRow: { flexDirection: "row", alignItems: "center", gap: 4, marginBottom: 24 },
  backText: { color: COLORS.cyan, fontSize: 13, fontWeight: "700" },
  brand: { alignItems: "center", marginBottom: 32, gap: 10 },
  badge: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: "rgba(34,211,238,0.12)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  title: { fontSize: 28, letterSpacing: 1 },
  helper: { color: COLORS.muted, fontSize: 14, textAlign: "center", paddingHorizontal: 20 },
  form: { gap: 14 },
  sentBox: { alignItems: "center", gap: 10, paddingVertical: 20 },
  sentTitle: { color: COLORS.text, fontSize: 20, fontWeight: "900", marginTop: 6 },
  sentBody: { color: COLORS.muted, fontSize: 14, textAlign: "center", lineHeight: 20, marginBottom: 16 },
  footer: { marginTop: 24, alignItems: "center" },
  footnote: { color: COLORS.muted, fontSize: 14 },
  link: { color: COLORS.cyan, fontWeight: "800" },
});
