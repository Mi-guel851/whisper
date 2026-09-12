import { Ionicons } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import * as Clipboard from "expo-clipboard";
import { router } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";

import { CoinBadge } from "@/components/CoinBadge";
import { GradientButton } from "@/components/GradientButton";
import { Screen } from "@/components/Screen";
import { ConfirmSheet, SheetRow } from "@/components/Sheet";
import { Toggle } from "@/components/Toggle";
import { resetBadges } from "@/lib/badges";
import { maskAddress, fetchWallet } from "@/lib/coins";
import { hapticsEnabled, setHapticsEnabled, vibrate } from "@/lib/haptics";
import { appVersion, detachNotifications } from "@/lib/push";
import {
  DEFAULT_PREFS,
  fetchNotificationPrefs,
  fetchProfile,
  saveNotificationPref,
  whisperLink,
  type NotificationPrefs,
} from "@/lib/profile";
import { useSession } from "@/lib/session";
import { useTheme, type ThemePreference } from "@/lib/ThemeProvider";
import { useToast } from "@/lib/toast";
import { COLORS, FILLS, GLASS, RADIUS, useStyles } from "@/lib/theme";
import type { Profile } from "@/lib/types";

/**
 * Settings.
 *
 * The web app's `/settings` plus `NotificationSettingsCard`: the push master
 * switch, the five per-category switches the profile table stores, the wallet
 * address, and the way out of the account.
 *
 * WHY THE SWITCHES ARE WORTH THE SCREEN
 *
 * `profiles` carries six boolean columns, and NULL means on — the SQL reads
 * `is distinct from false`, so a row that predates the columns is opted in. The
 * toggles write `true` or `false` explicitly and never NULL, which is what lets
 * a user say no to one category without touching the others.
 *
 * Push itself is registered once per session by the session provider. Turning
 * the master switch off here only *unregisters locally* — detaching the
 * listener and clearing the badge — because revoking a device token server-side
 * would need the service role, and `register_device_token` is the only endpoint
 * the app is allowed to call. The next sign-in re-registers, so "off" survives
 * exactly as long as the session does; the profile column is what actually
 * stops the pushes from being sent.
 */
export default function Settings() {
  const styles = useStyles(makeStyles);
  const { session, userId, signOut, refreshPush } = useSession();
  const { showToast } = useToast();
  const { themeId, setThemeId } = useTheme();

  const [prefs, setPrefs] = useState<NotificationPrefs>(DEFAULT_PREFS);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  const [haptics, setHaptics] = useState(hapticsEnabled());
  const [savingKey, setSavingKey] = useState<keyof NotificationPrefs | null>(null);
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!userId) return;

    const [loadedPrefs, row, wallet] = await Promise.all([
      fetchNotificationPrefs(userId),
      fetchProfile(userId),
      fetchWallet(userId),
    ]);

    setPrefs(loadedPrefs);
    setProfile(row);
    setBalance(wallet?.balance ?? 0);
    setAddress(wallet?.wallet_address ?? null);
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  /* The complete-profile gate, checked once per visit. An account that signed
     up on the website may already be complete; the flag only reroutes people
     who still owe the profile step — username, country and recovery phrase —
     because without them the database blocks messaging and forgot-password
     has nothing to verify. Same redirect target as the web app's
     `/complete-profile`; here it replaces settings so back cannot land on a
     screen whose account is not usable yet. */
  const routedToCompletion = React.useRef(false);
  useEffect(() => {
    if (!profile || routedToCompletion.current) return;
    if (profile.profile_completed === false) {
      routedToCompletion.current = true;
      router.replace("/complete-profile");
    }
  }, [profile]);

  const flip = async (key: keyof NotificationPrefs, value: boolean) => {
    if (!userId || savingKey) return;

    setSavingKey(key);
    const previous = prefs[key];
    setPrefs((current) => ({ ...current, [key]: value }));

    try {
      await saveNotificationPref(userId, key, value);

      /* Turning push back on has to re-register the token, or the switch would
         be a promise the device cannot keep. */
      if (key === "push_notifications" && value) await refreshPush();
      if (key === "push_notifications" && !value) await detachNotifications();
    } catch (error) {
      setPrefs((current) => ({ ...current, [key]: previous }));
      showToast(error instanceof Error ? error.message : "Couldn't save that setting.", {
        variant: "error",
      });
    } finally {
      setSavingKey(null);
    }
  };

  const doSignOut = async () => {
    setBusy(true);
    await detachNotifications();
    resetBadges();
    await signOut();
    setBusy(false);
    setConfirmSignOut(false);
    /* The root layout switches the route tree on the session; there is nothing
       to navigate to here. */
  };

  const rows: { key: keyof NotificationPrefs; label: string; detail: string; icon: keyof typeof Ionicons.glyphMap }[] = [
    {
      key: "push_notifications",
      label: "Push notifications",
      detail: "The master switch — off means nothing is delivered",
      icon: "notifications-outline",
    },
    {
      key: "notify_feed_posts",
      label: "New feed posts",
      detail: "When somebody posts to the public feed",
      icon: "sparkles-outline",
    },
    {
      key: "notify_replies",
      label: "Replies",
      detail: "When somebody answers one of your whispers",
      icon: "chatbubble-ellipses-outline",
    },
    {
      key: "notify_friend_requests",
      label: "Friend requests",
      detail: "When somebody asks to be friends",
      icon: "person-add-outline",
    },
    {
      key: "notify_coin_transfers",
      label: "Coin transfers",
      detail: "When coins arrive in your wallet",
      icon: "logo-bitcoin",
    },
    {
      key: "notify_calls",
      label: "Calls",
      detail: "Incoming and missed calls",
      icon: "call-outline",
    },
  ];

  return (
    <Screen padded={false}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} accessibilityLabel="Go back">
          <Ionicons name="chevron-back" size={24} color={COLORS.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Settings</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Wallet */}
        <Section title="Wallet">
          <View style={styles.walletRow}>
            <CoinBadge balance={balance} variant="prominent" onPress={() => router.push("/coins")} />
            <GradientButton
              label="Buy coins"
              icon="add"
              variant="glass"
              size="sm"
              onPress={() => router.push("/coins")}
            />
          </View>

          {address && (
            <Pressable
              onPress={() => {
                void Clipboard.setStringAsync(address);
                showToast("Address copied", { variant: "subtle" });
              }}
              style={styles.addressRow}
              accessibilityLabel="Copy your wallet address"
            >
              <Ionicons name="wallet-outline" size={15} color={COLORS.cyan} />
              <View style={styles.addressText}>
                <Text style={styles.addressLabel}>Your Whispers address</Text>
                <Text style={styles.addressValue}>{maskAddress(address)}</Text>
              </View>
              <Ionicons name="copy-outline" size={15} color={COLORS.subtle} />
            </Pressable>
          )}
        </Section>

        {/* Notifications */}
        <Section title="Notifications" subtitle="What reaches your phone">
          {rows.map((row) => (
            <SettingRow
              key={row.key}
              icon={row.icon}
              label={row.label}
              detail={row.detail}
              value={prefs[row.key]}
              disabled={savingKey === row.key || !prefs.push_notifications}
              onChange={(value) => void flip(row.key, value)}
            />
          ))}
        </Section>

        {/* Feel */}
        <Section title="Feel">
          <SettingRow
            icon="pulse-outline"
            label="Haptics"
            detail="A small tap when something happens"
            value={haptics}
            onChange={(value) => {
              setHaptics(value);
              setHapticsEnabled(value);
              if (value) vibrate("select");
            }}
          />
        </Section>

        {/* Appearance — the web app's /appearance page, in place: three
            choices, each with the same three-swatch preview, check on the
            active one. `system` follows the OS live. */}
        <Section title="Appearance" subtitle="Matches the website's themes">
          {THEME_CHOICES.map((choice) => {
            const active = choice.id === themeId;
            return (
              <Pressable
                key={choice.id}
                accessibilityRole="button"
                accessibilityLabel={`Theme: ${choice.name}`}
                onPress={() => {
                  vibrate("tap");
                  setThemeId(choice.id as ThemePreference);
                }}
                style={({ pressed }) => [
                  styles.themeRow,
                  active && styles.themeRowActive,
                  pressed && { opacity: 0.85 },
                ]}
              >
                <View style={styles.swatchStack}>
                  {choice.swatch.map((c) => (
                    <View key={c} style={[styles.swatch, { backgroundColor: c }]} />
                  ))}
                </View>
                <Text style={[styles.themeLabel, active && { color: COLORS.text }]}>{choice.name}</Text>
                {active ? (
                  <View style={styles.themeCheck}>
                    <Ionicons name="checkmark" size={15} color={COLORS.contrast} />
                  </View>
                ) : null}
              </Pressable>
            );
          })}
        </Section>

        {/* Account */}
        <Section title="Account">
          <SheetRow
            icon="at-outline"
            label="Username"
            detail={profile?.username ? `@${profile.username}` : "Not set"}
            onPress={() =>
              showToast("Usernames are changed on the website for now.", { variant: "subtle" })
            }
          />
          <SheetRow
            icon="link-outline"
            label="Your whisper link"
            detail={whisperLink(profile?.username)}
            onPress={() => {
              void Clipboard.setStringAsync(whisperLink(profile?.username));
              showToast("Link copied", { variant: "subtle" });
            }}
          />
          <SheetRow
            icon="refresh-outline"
            label="Resync notifications"
            detail="Re-register this device for push"
            onPress={() => {
              void refreshPush().then(() => showToast("Notifications resynced", { variant: "success" }));
            }}
          />
          <SheetRow
            icon="shield-checkmark-outline"
            label="Privacy"
            detail="Anonymous by design — we never ask for your real name"
            onPress={() =>
              showToast("Whispers are anonymous. Only your email is on file.", { variant: "subtle" })
            }
          />
        </Section>

        {/* About */}
        <Section title="About">
          <View style={styles.aboutRow}>
            <Text style={styles.aboutLabel}>Version</Text>
            <Text style={styles.aboutValue}>{appVersion()}</Text>
          </View>
          <View style={styles.aboutRow}>
            <Text style={styles.aboutLabel}>Signed in as</Text>
            <Text style={styles.aboutValue} numberOfLines={1}>
              {session?.user?.email ?? "—"}
            </Text>
          </View>
          <SheetRow
            icon="compass-outline"
            label="Discover Whisper"
            detail="Games, friends and more"
            onPress={() => router.push("/discover")}
          />
          <SheetRow
            icon="globe-outline"
            label="Open the website"
            onPress={() => {
              void Linking.openURL(process.env.EXPO_PUBLIC_SITE_URL || "https://whisper-anonymous.vercel.app");
            }}
          />
        </Section>

        <GradientButton
          label="Log out"
          icon="log-out-outline"
          variant="glass"
          size="lg"
          fullWidth
          onPress={() => {
            vibrate("warning");
            setConfirmSignOut(true);
          }}
          style={styles.signOut}
        />

        <Text style={styles.footer}>
          Whisper keeps no history of who sent what. Deleting the app deletes the device token with it.
        </Text>
      </ScrollView>

      <ConfirmSheet
        visible={confirmSignOut}
        title="Log out?"
        message="You can sign back in any time — your whispers and coins stay where they are."
        confirmLabel="Log out"
        destructive
        busy={busy}
        onConfirm={() => void doSignOut()}
        onCancel={() => setConfirmSignOut(false)}
      />
    </Screen>
  );
}

/* ---------------------------------------------------------------------------
 * Pieces
 * ------------------------------------------------------------------------ */

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  const styles = useStyles(makeStyles);
  return (
    <View style={styles.section}>
      <View style={styles.sectionHead}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {subtitle ? <Text style={styles.sectionSub}>{subtitle}</Text> : null}
      </View>

      <BlurView intensity={GLASS.blurIntensity} tint="dark" style={styles.sectionCard}>
        <View style={styles.sectionInner}>{children}</View>
      </BlurView>
    </View>
  );
}

function SettingRow({
  icon,
  label,
  detail,
  value,
  onChange,
  disabled = false,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  detail: string;
  value: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  const styles = useStyles(makeStyles);
  const dim = useSharedValue(disabled ? 0.45 : 1);

  useEffect(() => {
    dim.value = withTiming(disabled ? 0.45 : 1, { duration: 180, easing: Easing.out(Easing.cubic) });
  }, [dim, disabled]);

  const style = useAnimatedStyle(() => ({ opacity: dim.value }));

  return (
    <Animated.View style={style}>
      <View style={styles.settingRow}>
        <View style={styles.settingIcon}>
          <Ionicons name={icon} size={17} color={COLORS.cyan} />
        </View>

        <View style={styles.settingText}>
          <Text style={styles.settingLabel}>{label}</Text>
          <Text style={styles.settingDetail}>{detail}</Text>
        </View>

        <Toggle value={value} onChange={onChange} disabled={disabled} />
      </View>
    </Animated.View>
  );
}

/** The web app's `lib/themes.ts` swatches, one for one. */
const THEME_CHOICES: { id: string; name: string; swatch: [string, string, string] }[] = [
  { id: "system", name: "System", swatch: ["#FFFFFF", "#8B5CF6", "#000000"] },
  { id: "light", name: "Light", swatch: ["#FFFFFF", "#F5F5F5", "#EC4899"] },
  { id: "dark", name: "Dark", swatch: ["#000000", "#111111", "#8B5CF6"] },
];

const makeStyles = () => StyleSheet.create({
  themeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: "transparent",
  },
  themeRowActive: {
    borderColor: GLASS.borderStrong,
    backgroundColor: FILLS[1],
  },
  swatchStack: {
    flexDirection: "row",
    width: 44,
    height: 26,
    borderRadius: RADIUS.sm,
    overflow: "hidden",
  },
  swatch: { width: 44 / 3, height: "100%" },
  themeLabel: { flex: 1, color: COLORS.muted, fontSize: 14.5, fontWeight: "700" },
  themeCheck: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.violet,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 10,
  },
  headerTitle: { color: COLORS.text, fontSize: 18, fontWeight: "900" },
  headerSpacer: { width: 24 },

  scroll: { paddingHorizontal: 16, paddingBottom: 40, gap: 18 },

  section: { gap: 8 },
  sectionHead: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between" },
  sectionTitle: {
    color: COLORS.muted,
    fontSize: 11.5,
    fontWeight: "800",
    letterSpacing: 0.7,
    textTransform: "uppercase",
  },
  sectionSub: { color: COLORS.subtle, fontSize: 11 },
  sectionCard: {
    borderRadius: RADIUS.xl,
    borderWidth: 1,
    borderColor: GLASS.border,
    backgroundColor: "rgba(23,18,42,0.5)",
    overflow: "hidden",
  },
  sectionInner: { paddingHorizontal: 14, paddingVertical: 4 },

  walletRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12 },
  addressRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: GLASS.border,
  },
  addressText: { flex: 1 },
  addressLabel: { color: COLORS.muted, fontSize: 11, fontWeight: "700" },
  addressValue: { color: COLORS.text, fontSize: 13.5, fontWeight: "700", marginTop: 2, letterSpacing: 0.4 },

  settingRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12 },
  settingIcon: {
    width: 34,
    height: 34,
    borderRadius: 12,
    backgroundColor: "rgba(34,211,238,0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  settingText: { flex: 1 },
  settingLabel: { color: COLORS.text, fontSize: 14.5, fontWeight: "700" },
  settingDetail: { color: COLORS.muted, fontSize: 11.5, marginTop: 2, lineHeight: 16 },

  aboutRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    paddingVertical: 12,
  },
  aboutLabel: { color: COLORS.muted, fontSize: 13, fontWeight: "600" },
  aboutValue: { color: COLORS.text, fontSize: 13, fontWeight: "700", flexShrink: 1 },

  signOut: { marginTop: 4 },
  footer: { color: COLORS.subtle, fontSize: 11, textAlign: "center", lineHeight: 16, paddingHorizontal: 12 },
});
