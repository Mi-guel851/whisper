import type { ComponentProps } from "react";
import { TextInput } from "react-native";

export default function Field(props: ComponentProps<typeof TextInput>) {
  return <TextInput placeholderTextColor="#8d879e" {...props} className={`rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-4 text-base text-white ${props.className ?? ""}`} />;
}