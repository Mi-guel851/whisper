import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import * as Application from "expo-application";

import { Avatar } from "@/components/Avatar";
import { GlassCard } from "@/components/GlassCard";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/lib/session";
import { COLORS, GLASS, GRADIENT_COLORS, RADIUS } from "@/lib/theme";
import { useToast } from "@/lib/toast";
import { fetchNotificationPrefs, saveNotificationPref } from "@/lib/profile";

/**
 * Settings screen.
 *
 * Push notification toggle, Coin Store link, App version row, Log Out.
 */
export default function SettingsScreen() {
  const { userId, profile } = useSession();
  const { showToast } = useToast();
  const [pushEnabled, setPushEnabled] = useState(true);
  const [version, setVersion] = useState("1.0.0");

  useEffect(() => {
    setVersion(Application.nativeApplicationVersion ?? "1.0.0");
  }, []);

  useEffect(() => {
    if (!userId) return;
    (async () => {
      const prefs = await fetchNotificationPrefs(userId);
      setPushEnabled(prefs.push);
    })();
  }, [userId]);

  const handleTogglePush = async (val: boolean) => {
    setPushEnabled(val);
    try {
      if (userId) await saveNotificationPref(userId, "push", val);
    } catch (err: any) {
      showToast("Couldn't save push preference", { variant: "error" });
      setPushEnabled(!val);
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    showToast("Signed out", { variant: "info" });
    router.replace("/(auth)/login");
  };

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color={COLORS.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Settings</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }}>
        <GlassCard radius={RADIUS.xl} style={styles.profileCard}>
          {userId && <Avatar authorId={userId} size={60} />}
          <View style={{ flex: 1 }}>
            <Text style={styles.displayName}>{profile?.display_name ?? "Whisperer"}</Text>
            <Text style={styles.handle}>@{profile?.username ?? "user"}</Text>
          </View>
        </GlassCard>

        <GlassCard radius={RADIUS.xl} style={{ padding: 0 }}>
          <SettingsRow
            icon="notifications-outline"
            label="Push Notifications"
            right={
              <Switch
                value={pushEnabled}
                onValueChange={handleTogglePush}
                trackColor={{ false: "rgba(255,255,255,0.15)", true: COLORS.cyan }}
                thumbColor="#0a0814"
              />
            }
          />
          <Divider />
          <SettingsRow
            icon="logo-bitcoin"
            label="Coin Store"
            right={<Ionicons name="chevron-forward" size={18} color={COLORS.muted} />}
            onPress={() => router.push("/coins")}
          />
          <Divider />
          <SettingsRow
            icon="information-circle-outline"
            label="App Version"
            right={<Text style={styles.versionText}>{version}</Text>}
          />
        </GlassCard>

        <Pressable onPress={handleLogout} style={styles.logoutBtn}>
          <Ionicons name="log-out-outline" size={20} color={COLORS.danger} />
          <Text style={styles.logoutText}>Log Out</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

function SettingsRow({
  icon,
  label,
  right,
  onPress,
}: {
  icon: string;
  label: string;
  right: React.ReactNode;
  onPress?: () => void;
}) {
  return (
    <Pressable style={styles.settingRow} onPress={onPress} disabled={!onPress}>
      <View style={styles.settingIconWrap}>
        <Ionicons name={icon as any} size={20} color={COLORS.cyan} />
      </View>
      <Text style={styles.settingLabel}>{label}</Text>
      <View style={{ marginLeft: "auto" }}>{right}</View>
    </Pressable>
  );
}

function Divider() {
  return <View style={styles.divider} />;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.background },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 8,
    paddingTop: 50,
    paddingBottom: 8,
  },
  backBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  headerTitle: { color: COLORS.text, fontSize: 18, fontWeight: "900" },
  profileCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    padding: 16,
  },
  displayName: { color: COLORS.text, fontSize: 18, fontWeight: "900" },
  handle: { color: COLORS.muted, fontSize: 13, marginTop: 2 },
  settingRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    gap: 14,
  },
  settingIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(34,211,238,0.1)",
  },
  settingLabel: { color: COLORS.text, fontSize: 15, fontWeight: "700" },
  versionText: { color: COLORS.muted, fontSize: 13, fontWeight: "700" },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: GLASS.border,
    marginLeft: 64,
  },
  logoutBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    padding: 14,
    borderRadius: RADIUS.pill,
    backgroundColor: "rgba(239,68,68,0.12)",
    borderWidth: 1,
    borderColor: "rgba(239,68,68,0.3)",
  },
  logoutText: { color: COLORS.danger, fontSize: 15, fontWeight: "800" },
});
