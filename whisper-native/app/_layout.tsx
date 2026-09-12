import "../global.css";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import PushTokenSync from "../components/PushTokenSync";

export default function RootLayout() {
  return <><StatusBar style="light" /><PushTokenSync /><Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: "#0a0814" } }}><Stack.Screen name="create-whisper" options={{ presentation: "modal" }} /><Stack.Screen name="whisper-detail" options={{ presentation: "modal" }} /><Stack.Screen name="conversation" options={{ presentation: "modal" }} /><Stack.Screen name="settings" options={{ presentation: "modal" }} /><Stack.Screen name="coins" options={{ presentation: "modal" }} /></Stack></>;
}