import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import Animated, { FadeInDown } from "react-native-reanimated";

import { Background } from "@/components/Background";
import { GradientButton } from "@/components/GradientButton";
import { GradientText } from "@/components/GradientText";
import {
  adminFetch,
  ANNOUNCEMENT_AUDIENCES,
  ANNOUNCEMENT_KINDS,
  clearStoredPin,
  createAnnouncement,
  getStoredPin,
  isAdminEmail,
  listAnnouncements,
  verifyPin,
  type AdminAnnouncement,
  type AnnouncementAudience,
  type AnnouncementKind,
} from "@/lib/adminClient";
import { vibrate } from "@/lib/haptics";
import { useSession } from "@/lib/session";
import { useToast } from "@/lib/toast";
import { COLORS, RADIUS, useStyles } from "@/lib/theme";

/**
 * The admin console — the native door to the web panel's announcements admin
 * (`/admin/announcements`): list what is live, and publish a new one.
 *
 * TWO GATES, the web panel's exact pair:
 *
 *   1. the account must be on the admin email allowlist (checked here only to
 *      decide what to *show* — every API route re-verifies server-side);
 *   2. the ADMIN_GRANT_PIN, verified against `/api/admin/session`. The PIN
 *      lives in memory, not storage — the native twin of the web's
 *      sessionStorage — so leaving the app ends the unlock.
 *
 * Full moderation (users, bans, reports, coins) stays web-only on purpose:
 * those tables deserve a keyboard and a wide screen, and the standing rule is
 * that native adds no new server surface. Announcements are the piece an
 * admin needs from a phone — "the feed is broken, tell everyone now".
 */

export default function AdminConsole() {
  const styles = useStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const { showToast } = useToast();
  const { session, userId } = useSession();

  const isAdmin = isAdminEmail(session?.user?.email ?? null);
  const [pin, setPin] = useState("");
  const [unlocked, setUnlocked] = useState(Boolean(getStoredPin()));
  const [verifying, setVerifying] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);

  const [announcements, setAnnouncements] = useState<AdminAnnouncement[] | null>(null);
  const [loadingList, setLoadingList] = useState(false);

  /* Composer state */
  const [kind, setKind] = useState<AnnouncementKind>("info");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [audience, setAudience] = useState<AnnouncementAudience>("everyone");
  const [ctaLabel, setCtaLabel] = useState("");
  const [ctaHref, setCtaHref] = useState("");
  const [pollOptions, setPollOptions] = useState<string[]>(["", ""]);
  const [publishing, setPublishing] = useState(false);

  const load = useCallback(async () => {
    setLoadingList(true);
    try {
      const { announcements: rows } = await listAnnouncements();
      setAnnouncements(rows);
    } catch (cause) {
      setAnnouncements([]);
      showToast(cause instanceof Error ? cause.message : "Couldn't load announcements.", { variant: "error" });
    } finally {
      setLoadingList(false);
    }
  }, [showToast]);

  useEffect(() => {
    if (isAdmin && unlocked) void load();
  }, [isAdmin, load, unlocked]);

  const unlock = async () => {
    if (!pin.trim() || verifying) return;
    setVerifying(true);
    setPinError(null);
    try {
      await verifyPin(pin.trim());
      vibrate("success");
      setUnlocked(true);
      setPin("");
    } catch (cause) {
      vibrate("warning");
      setPinError(cause instanceof Error ? cause.message : "That PIN didn't take.");
    } finally {
      setVerifying(false);
    }
  };

  const publish = async () => {
    if (publishing) return;
    const trimmedTitle = title.trim();
    const trimmedBody = body.trim();
    if (!trimmedTitle) return void showToast("A title is required.", { variant: "error" });
    if (!trimmedBody) return void showToast("A message is required.", { variant: "error" });
    if (kind === "poll" && pollOptions.map((o) => o.trim()).filter(Boolean).length < 2) {
      return void showToast("A poll needs at least two options.", { variant: "error" });
    }

    setPublishing(true);
    try {
      await createAnnouncement({
        kind,
        title: trimmedTitle.slice(0, 80),
        body: trimmedBody.slice(0, 600),
        imageUrl: null,
        ctaLabel: kind === "cta" && ctaLabel.trim() ? ctaLabel.trim().slice(0, 40) : null,
        ctaHref: kind === "cta" && ctaHref.trim() ? ctaHref.trim() : null,
        audience,
        audienceIds: [],
        startsAt: null,
        endsAt: null,
        active: true,
        pollOptions: kind === "poll" ? pollOptions.map((o) => o.trim()).filter(Boolean).slice(0, 6) : [],
      });
      vibrate("success");
      showToast("Announcement published", { variant: "success" });
      setTitle("");
      setBody("");
      setCtaLabel("");
      setCtaHref("");
      setPollOptions(["", ""]);
      void load();
    } catch (cause) {
      vibrate("warning");
      showToast(cause instanceof Error ? cause.message : "Couldn't publish that.", { variant: "error" });
    } finally {
      setPublishing(false);
    }
  };

  const lock = () => {
    clearStoredPin();
    setUnlocked(false);
    showToast("Panel locked.", { variant: "subtle" });
  };

  return (
    <View style={styles.root}>
      <Background />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView
          contentContainerStyle={[
            styles.scroll,
            { paddingTop: insets.top + 18, paddingBottom: Math.max(insets.bottom, 24) + 32 },
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.head}>
            <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Go back" hitSlop={8}>
              <Ionicons name="chevron-back" size={22} color={COLORS.text} />
            </Pressable>
            <View style={styles.brandRow}>
              <View style={styles.mark}>
                <Ionicons name="shield-checkmark" size={16} color={COLORS.cyan} />
              </View>
              <GradientText style={styles.title}>Admin</GradientText>
            </View>
            {unlocked ? (
              <Pressable onPress={lock} accessibilityRole="button" accessibilityLabel="Lock the panel" style={styles.lockBtn}>
                <Text style={styles.lockText}>Lock</Text>
              </Pressable>
            ) : null}
          </View>

          {!session ? (
            <StateBlock icon="log-in-outline" title="Sign in first" text="The admin console checks your account's session." />
          ) : !isAdmin ? (
            <StateBlock
              icon="shield-outline"
              title="Not authorized"
              text="This console is limited to Whisper's admin accounts. Your email isn't on the list."
              danger
            />
          ) : !unlocked ? (
            <Animated.View entering={FadeInDown.duration(300)} style={styles.card}>
              <Text style={styles.cardTitle}>Admin PIN</Text>
              <Text style={styles.cardSub}>The second factor. Verified against the server, kept in memory only.</Text>
              <TextInput
                value={pin}
                onChangeText={setPin}
                placeholder="PIN"
                placeholderTextColor={COLORS.subtle}
                secureTextEntry
                keyboardType="number-pad"
                style={styles.input}
                onSubmitEditing={() => void unlock()}
              />
              {pinError ? <Text style={styles.pinError}>{pinError}</Text> : null}
              <GradientButton
                label="Unlock"
                icon="lock-open-outline"
                fullWidth
                loading={verifying}
                disabled={!pin.trim()}
                onPress={() => void unlock()}
                style={styles.unlockBtn}
              />
            </Animated.View>
          ) : (
            <>
              {/* Composer */}
              <View style={styles.card}>
                <Text style={styles.cardTitle}>New announcement</Text>

                <View style={styles.chipRow}>
                  {ANNOUNCEMENT_KINDS.map((k) => (
                    <Pressable
                      key={k}
                      onPress={() => {
                        vibrate("tap");
                        setKind(k);
                      }}
                      style={[styles.chip, kind === k && styles.chipActive]}
                      accessibilityRole="button"
                      accessibilityLabel={`Type: ${k}`}
                    >
                      <Text style={[styles.chipText, kind === k && styles.chipTextActive]}>{k}</Text>
                    </Pressable>
                  ))}
                </View>

                <TextInput
                  value={title}
                  onChangeText={setTitle}
                  placeholder="Title"
                  placeholderTextColor={COLORS.subtle}
                  maxLength={80}
                  style={styles.input}
                />
                <TextInput
                  value={body}
                  onChangeText={setBody}
                  placeholder="Message"
                  placeholderTextColor={COLORS.subtle}
                  maxLength={600}
                  multiline
                  style={[styles.input, styles.inputArea]}
                />

                {kind === "poll" ? (
                  <View style={styles.pollWrap}>
                    {pollOptions.map((option, index) => (
                      <TextInput
                        key={index}
                        value={option}
                        onChangeText={(value) =>
                          setPollOptions((current) => current.map((o, i) => (i === index ? value : o)))
                        }
                        placeholder={`Option ${index + 1}`}
                        placeholderTextColor={COLORS.subtle}
                        maxLength={80}
                        style={styles.input}
                      />
                    ))}
                    {pollOptions.length < 6 ? (
                      <Pressable
                        onPress={() => setPollOptions((current) => [...current, ""])}
                        style={styles.addOption}
                        accessibilityRole="button"
                        accessibilityLabel="Add poll option"
                      >
                        <Ionicons name="add" size={15} color={COLORS.cyan} />
                        <Text style={styles.addOptionText}>Add option</Text>
                      </Pressable>
                    ) : null}
                  </View>
                ) : null}

                {kind === "cta" ? (
                  <View style={styles.pollWrap}>
                    <TextInput
                      value={ctaLabel}
                      onChangeText={setCtaLabel}
                      placeholder="Button label"
                      placeholderTextColor={COLORS.subtle}
                      maxLength={40}
                      style={styles.input}
                    />
                    <TextInput
                      value={ctaHref}
                      onChangeText={setCtaHref}
                      placeholder="Destination (/discover or https://…)"
                      placeholderTextColor={COLORS.subtle}
                      autoCapitalize="none"
                      style={styles.input}
                    />
                  </View>
                ) : null}

                <View style={styles.chipRow}>
                  {ANNOUNCEMENT_AUDIENCES.map((a) => (
                    <Pressable
                      key={a}
                      onPress={() => {
                        vibrate("tap");
                        setAudience(a);
                      }}
                      style={[styles.chip, audience === a && styles.chipActive]}
                      accessibilityRole="button"
                      accessibilityLabel={`Audience: ${a}`}
                    >
                      <Text style={[styles.chipText, audience === a && styles.chipTextActive]}>{a.replace(/_/g, " ")}</Text>
                    </Pressable>
                  ))}
                </View>

                <GradientButton
                  label="Publish"
                  icon="megaphone-outline"
                  fullWidth
                  loading={publishing}
                  disabled={!title.trim() || !body.trim()}
                  onPress={() => void publish()}
                  style={styles.unlockBtn}
                />
              </View>

              {/* Live list */}
              <View style={styles.listWrap}>
                <Text style={styles.listTitle}>Announcements</Text>
                {loadingList && announcements === null ? (
                  <Text style={styles.listEmpty}>Loading…</Text>
                ) : !announcements || announcements.length === 0 ? (
                  <Text style={styles.listEmpty}>Nothing published yet.</Text>
                ) : (
                  announcements.map((row) => (
                    <View key={row.id} style={styles.announcement}>
                      <View style={styles.announcementHead}>
                        <Text style={styles.announcementKind}>{row.kind}</Text>
                        <Text style={styles.announcementState}>{row.state}</Text>
                      </View>
                      <Text style={styles.announcementTitle} numberOfLines={1}>
                        {row.title}
                      </Text>
                      <Text style={styles.announcementBody} numberOfLines={2}>
                        {row.body}
                      </Text>
                      {row.kind === "poll" && row.poll_options?.length ? (
                        <Text style={styles.announcementMeta}>
                          {row.poll_options.length} options · {row.total_votes} votes
                        </Text>
                      ) : (
                        <Text style={styles.announcementMeta}>to {row.audience.replace(/_/g, " ")}</Text>
                      )}
                    </View>
                  ))
                )}
              </View>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

function StateBlock({ icon, title, text, danger = false }: { icon: keyof typeof Ionicons.glyphMap; title: string; text: string; danger?: boolean }) {
  const styles = useStyles(makeStyles);
  return (
    <View style={styles.state}>
      <View style={[styles.stateMark, danger && { backgroundColor: COLORS.danger, opacity: 0.14 }]}>
        <Ionicons name={icon} size={26} color={danger ? COLORS.danger : COLORS.warning} />
      </View>
      <Text style={styles.stateTitle}>{title}</Text>
      <Text style={styles.stateText}>{text}</Text>
    </View>
  );
}

const makeStyles = () =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: COLORS.background },
    flex: { flex: 1 },
    scroll: { paddingHorizontal: 18 },

    head: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 18 },
    brandRow: { flexDirection: "row", alignItems: "center", gap: 8, flex: 1 },
    mark: {
      width: 30,
      height: 30,
      borderRadius: 15,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: COLORS.card,
    },
    title: { fontSize: 18, fontWeight: "900", letterSpacing: -0.3 },
    lockBtn: { paddingHorizontal: 10, paddingVertical: 6 },
    lockText: { color: COLORS.danger, fontSize: 13, fontWeight: "800" },

    state: { alignItems: "center", gap: 10, paddingVertical: 64, paddingHorizontal: 30 },
    stateMark: {
      width: 64,
      height: 64,
      borderRadius: 32,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: COLORS.warning,
      opacity: 0.9,
    },
    stateTitle: { color: COLORS.text, fontSize: 18, fontWeight: "900" },
    stateText: { color: COLORS.muted, fontSize: 13.5, textAlign: "center", lineHeight: 20 },

    card: {
      borderRadius: RADIUS.xl,
      borderWidth: 1,
      borderColor: COLORS.border,
      backgroundColor: COLORS.card,
      padding: 14,
      gap: 12,
    },
    cardTitle: { color: COLORS.text, fontSize: 16, fontWeight: "900" },
    cardSub: { color: COLORS.subtle, fontSize: 12.5, lineHeight: 18, marginTop: -6 },
    input: {
      color: COLORS.text,
      fontSize: 15,
      paddingVertical: 10,
      paddingHorizontal: 12,
      borderRadius: RADIUS.md,
      backgroundColor: COLORS.surface,
      borderWidth: 1,
      borderColor: COLORS.border,
    },
    inputArea: { minHeight: 96, textAlignVertical: "top", lineHeight: 21 },
    pinError: { color: COLORS.danger, fontSize: 12.5, fontWeight: "700", marginTop: -4 },
    unlockBtn: { marginTop: 2 },

    chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    chip: {
      paddingVertical: 7,
      paddingHorizontal: 12,
      borderRadius: RADIUS.pill,
      borderWidth: 1,
      borderColor: COLORS.border,
      backgroundColor: COLORS.surface,
    },
    chipActive: { borderColor: COLORS.violet, backgroundColor: COLORS.violet, opacity: 0.16 },
    chipText: { color: COLORS.muted, fontSize: 12.5, fontWeight: "800", textTransform: "capitalize" },
    chipTextActive: { color: COLORS.text },

    pollWrap: { gap: 8 },
    addOption: { flexDirection: "row", alignItems: "center", gap: 5, paddingVertical: 4 },
    addOptionText: { color: COLORS.cyan, fontSize: 13, fontWeight: "800" },

    listWrap: { gap: 10, marginTop: 22 },
    listTitle: {
      color: COLORS.subtle,
      fontSize: 11,
      fontWeight: "800",
      letterSpacing: 1,
      textTransform: "uppercase",
    },
    listEmpty: { color: COLORS.subtle, fontSize: 13 },
    announcement: {
      borderRadius: RADIUS.md,
      borderWidth: 1,
      borderColor: COLORS.border,
      backgroundColor: COLORS.card,
      padding: 12,
      gap: 5,
    },
    announcementHead: { flexDirection: "row", alignItems: "center", gap: 8 },
    announcementKind: {
      color: COLORS.cyan,
      fontSize: 10.5,
      fontWeight: "900",
      textTransform: "uppercase",
      letterSpacing: 1,
    },
    announcementState: { color: COLORS.subtle, fontSize: 10.5, fontWeight: "800", textTransform: "uppercase" },
    announcementTitle: { color: COLORS.text, fontSize: 14.5, fontWeight: "800" },
    announcementBody: { color: COLORS.muted, fontSize: 13, lineHeight: 18 },
    announcementMeta: { color: COLORS.subtle, fontSize: 11.5, fontWeight: "700" },
  });
