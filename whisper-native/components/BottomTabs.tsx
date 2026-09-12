import { Text, View } from "react-native";
import { Link, usePathname } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

const items = [["feed", "home-outline", "Feed"], ["messages", "chatbubbles-outline", "Messages"], ["notifications", "notifications-outline", "Alerts"], ["profile", "person-outline", "Profile"]] as const;

export default function BottomTabs() {
  const pathname = usePathname();
  return <View className="mx-4 mb-4 flex-row justify-around rounded-3xl border border-white/10 bg-[#151021]/95 px-2 py-3">{items.map(([href, icon, label]) => { const active = pathname.includes(`/${href}`); return <Link key={href} href={`/(tabs)/${href}`} className="items-center px-3"><Ionicons name={icon} size={22} color={active ? "#22d3ee" : "#8d879e"} /><Text className={`mt-1 text-[10px] font-bold ${active ? "text-cyan-300" : "text-slate-400"}`}>{label}</Text></Link>; })}</View>;
}