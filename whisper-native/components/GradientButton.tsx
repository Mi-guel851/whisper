import type { PropsWithChildren } from "react";
import { Pressable, Text } from "react-native";
import { LinearGradient } from "expo-linear-gradient";

export default function GradientButton({ children, onPress, disabled = false }: PropsWithChildren<{ onPress?: () => void; disabled?: boolean }>) {
  return <Pressable onPress={onPress} disabled={disabled} className="overflow-hidden rounded-2xl active:opacity-80"><LinearGradient colors={["#22d3ee", "#a855f7"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} className="items-center justify-center px-5 py-4"><Text className="font-bold text-white">{children}</Text></LinearGradient></Pressable>;
}