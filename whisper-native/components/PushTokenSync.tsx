import { useEffect } from "react";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { supabase } from "../lib/supabase";

export default function PushTokenSync() {
  useEffect(() => { let active = true; async function sync() { const { data: session } = await supabase.auth.getSession(); if (!session.session || !active) return; const permission = await Notifications.getPermissionsAsync(); if (permission.status !== "granted") return; const token = await Notifications.getDevicePushTokenAsync(); await supabase.from("device_tokens").upsert({ user_id: session.session.user.id, fcm_token: token.data, platform: Platform.OS }, { onConflict: "fcm_token" }); } void sync(); return () => { active = false; }; }, []);
  return null;
}