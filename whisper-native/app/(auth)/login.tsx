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
import { COLORS, RADIUS } from "@/lib/theme";
import { useToast } from "@/lib/toast";

/**
 * Login screen.
 *
 * Email + password, dark glass inputs, cyan focus border, gradient Login
 * button, links to signup and forgot-password, inline error handling.
 */
export default function LoginScreen() {
  const { showToast } = useToast();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleLogin() {
    setError(null);
    if (!email.trim() || !password) {
      setError("Enter your email and password.");
      return;
    }
    setLoading(true);
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    setLoading(false);

    if (signInError) {
      setError(signInError.message);
      showToast(signInError.message, { variant: "error" });
      return;
    }

    showToast("Welcome back! 👋", { variant: "success" });
    router.replace("/(tabs)/feed");
  }

  return (
    <View style={styles.root}>
      <Background />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.brand}>
            <GradientText style={styles.title}>WHISPER</GradientText>
            <Text style={styles.subtitle}>Welcome Back</Text>
            <Text style={styles.helper}>Login to your Whisper account</Text>
          </View>

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
              returnKeyType="next"
              error={error && error.toLowerCase().includes("email") ? error : null}
            />
            <Field
              label="Password"
              icon="lock-closed-outline"
              value={password}
              onChangeText={setPassword}
              placeholder="••••••••"
              secureTextEntry
              autoComplete="password"
              returnKeyType="done"
              onSubmitEditing={handleLogin}
            />

            {error && !error.toLowerCase().includes("email") ? (
              <Text style={styles.error}>{error}</Text>
            ) : null}

            <View style={{ marginTop: 8 }}>
              <GradientButton label={loading ? "Logging in..." : "Login"} onPress={handleLogin} loading={loading} />
            </View>

            <Link href="/forgot-password" asChild>
              <Pressable style={styles.forgotWrap}>
                <Text style={styles.forgot}>Forgot password?</Text>
              </Pressable>
            </Link>
          </View>

          <View style={styles.footer}>
            <Text style={styles.footnote}>
              Don&apos;t have an account?{" "}
              <Text style={styles.link} onPress={() => router.push("/(auth)/signup")}>
                Sign Up
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
  content: { flexGrow: 1, padding: 24, paddingTop: 72, justifyContent: "center" },
  brand: { alignItems: "center", marginBottom: 36, gap: 6 },
  title: { fontSize: 36, letterSpacing: 4 },
  subtitle: { color: COLORS.text, fontSize: 24, fontWeight: "900", marginTop: 10 },
  helper: { color: COLORS.muted, fontSize: 14 },
  form: { gap: 14 },
  error: {
    color: COLORS.danger,
    fontSize: 13,
    fontWeight: "600",
    marginLeft: 4,
  },
  forgotWrap: { alignSelf: "flex-end", paddingVertical: 4, paddingHorizontal: 4 },
  forgot: { color: COLORS.cyan, fontSize: 13, fontWeight: "700" },
  footer: { marginTop: 28, alignItems: "center" },
  footnote: { color: COLORS.muted, fontSize: 14 },
  link: { color: COLORS.cyan, fontWeight: "800" },
});
