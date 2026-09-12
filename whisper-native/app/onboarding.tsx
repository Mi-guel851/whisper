import { Image, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Link } from "expo-router";
import Screen from "../components/Screen";
import GradientButton from "../components/GradientButton";

export default function Onboarding() {
  return <Screen scroll={false}><View className="flex-1 items-center justify-center"><Image source={require("../assets/icon.png")} className="mb-8 h-28 w-28 rounded-[32px]" /><Text className="text-center text-6xl font-black italic text-white">Whisper</Text><Text className="mt-4 max-w-[300px] text-center text-lg leading-7 text-slate-300">Say what you really think. Receive what people really feel.</Text><View className="mt-10 w-full"><Link href="/(auth)/login" asChild><GradientButton>Start whispering</GradientButton></Link><Link href="/(auth)/signup" className="mt-5 text-center font-semibold text-slate-300">Create your account</Link></View></View></Screen>;
}