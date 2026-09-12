import { useState } from "react";
import { Alert, Text, View } from "react-native";
import { Link, useRouter } from "expo-router";
import Screen from "../../components/Screen";
import Field from "../../components/Field";
import GradientButton from "../../components/GradientButton";
import GlassCard from "../../components/GlassCard";
import { supabase } from "../../lib/supabase";

export default function Login() {
  const router = useRouter(); const [email, setEmail] = useState(""); const [password, setPassword] = useState(""); const [loading, setLoading] = useState(false);
  async function submit() { setLoading(true); const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password }); setLoading(false); if (error) Alert.alert("Unable to log in", error.message); else router.replace("/(tabs)/feed"); }
  return <Screen scroll={false}><View className="flex-1 justify-center"><Text className="mb-2 text-center text-5xl font-black italic text-white">Whisper</Text><Text className="mb-8 text-center text-base text-slate-400">Anonymous, honest, yours.</Text><GlassCard strong><Text className="mb-1 text-3xl font-black text-white">Welcome back</Text><Text className="mb-6 text-slate-400">Log in to your Whisper account</Text><Field value={email} onChangeText={setEmail} placeholder="Email" keyboardType="email-address" autoCapitalize="none" /><Field value={password} onChangeText={setPassword} placeholder="Password" secureTextEntry className="mt-3" /><Link href="/forgot-password" className="my-4 self-end text-cyan-300">Forgot password?</Link><GradientButton onPress={submit} disabled={loading}>{loading ? "Logging in..." : "Log in"}</GradientButton></GlassCard><Link href="/(auth)/signup" className="mt-6 text-center font-semibold text-slate-300">New here? <Text className="text-cyan-300">Create an account</Text></Link></View></Screen>;
}