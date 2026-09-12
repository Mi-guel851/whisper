import type { PropsWithChildren } from "react";
import { ScrollView, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";

export default function Screen({ children, title, scroll = true }: PropsWithChildren<{ title?: string; scroll?: boolean }>) {
  const content = <View className="flex-1 px-5 pb-10 pt-5">{title ? <Text className="mb-5 text-3xl font-black text-white">{title}</Text> : null}{children}</View>;
  return <LinearGradient colors={["#0a0814", "#120b25", "#0a0814"]} className="flex-1">{scroll ? <ScrollView contentContainerStyle={{ flexGrow: 1 }}>{content}</ScrollView> : content}</LinearGradient>;
}