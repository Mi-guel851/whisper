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
import { validateUsername } from "@/lib/profile";

/**
 * Signup screen.
 *
 * Email + password + username, gradient Sign Up button. Uses supabase.auth.signUp
 * and creates the profile row through the database trigger when successful.
 */
export default function SignupScreen() {
  const { showToast } = useToast();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSignup() {
    setError(null);

    const u = username.trim().toLowerCase();
    const usernameErr = validateUsername(u);
    if (usernameErr) {
      setError(usernameErr);
      return;
    }
    if (!email.trim() || !password) {
      setError("Enter your email and choose a password.");
      return;
    }
    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }

    setLoading(true);
    const { data, error: signUpError } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: { data: { username: u, display_name: u } },
    });
    setLoading(false);

    if (signUpError) {
      setError(signUpError.message);
      showToast(signUpError.message, { variant: "error" });
      return;
    }

    // If a profile row was created server-side, stamp the username. The trigger
    // for profiles listens to auth.users inserts but the username column needs
    // to be set here because it is not in auth.users metadata.
    if (data.user) {
      const { error: profileErr } = await supabase
        .from("profiles")
        .update({ username: u, display_name: u })
        .eq("id", data.user.id);
      if (profileErr) console.warn("[signup] profile update:", profileErr.message);
    }

    showToast("Account created! 🎉", { variant: "success" });
    router.replace("/(tabs)/feed");
  }

  return (
    <View style={styles.root}>
      <Background />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.brand}>
            <GradientText style={styles.title}>WHISPER</GradientText>
            <Text style={styles.subtitle}>Create Account</Text>
            <Text style={styles.helper}>Get your own Whisper link in seconds</Text>
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
            />
            <Field
              label="Username"
              icon="at-outline"
              value={username}
              onChangeText={(v) => setUsername(v.replace(/[^a-zA-Z0-9_]/g, "").toLowerCase())}
              placeholder="yourname"
              autoComplete="username"
              autoCapitalize="none"
              returnKeyType="next"
            />
            <Field
              label="Password"
              icon="lock-closed-outline"
              value={password}
              onChangeText={setPassword}
              placeholder="At least 6 characters"
              secureTextEntry
              autoComplete="password"
              returnKeyType="done"
              onSubmitEditing={handleSignup}
            />

            {error ? <Text style={styles.error}>{error}</Text> : null}

            <View style={{ marginTop: 8 }}>
              <GradientButton
                label={loading ? "Creating account..." : "Sign Up"}
                onPress={handleSignup}
                loading={loading}
              />
            </View>
          </View>

          <View style={styles.footer}>
            <Text style={styles.footnote}>
              Already have an account?{" "}
              <Text style={styles.link} onPress={() => router.push("/(auth)/login")}>
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
  content: { flexGrow: 1, padding: 24, paddingTop: 64, justifyContent: "center" },
  brand: { alignItems: "center", marginBottom: 32, gap: 6 },
  title: { fontSize: 36, letterSpacing: 4 },
  subtitle: { color: COLORS.text, fontSize: 24, fontWeight: "900", marginTop: 10 },
  helper: { color: COLORS.muted, fontSize: 14 },
  form: { gap: 14 },
  error: { color: COLORS.danger, fontSize: 13, fontWeight: "600", marginLeft: 4 },
  footer: { marginTop: 28, alignItems: "center" },
  footnote: { color: COLORS.muted, fontSize: 14 },
  link: { color: COLORS.cyan, fontWeight: "800" },
});
