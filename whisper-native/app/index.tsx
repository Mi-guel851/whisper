import { useEffect } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { Redirect } from "expo-router";

export default function Index() {
  return <Redirect href="/onboarding" />;
}