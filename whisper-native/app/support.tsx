import Ionicons from "@expo/vector-icons/Ionicons";
import { useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { Field } from "@/components/Input";
import { GradientButton } from "@/components/GradientButton";
import { Screen } from "@/components/Screen";
import { vibrate } from "@/lib/haptics";
import { CARD_SHADOW, COLORS, GLASS, RADIUS } from "@/lib/theme";

/* The support categories, the web app's `/contact-support` list item for item.
   "Report Abuse" matters more than its neighbours: it is the escalation path
   the help center points harassment reports at, so it stays the default
   selection only in the sense that it is never hidden. */
const CATEGORIES = [
  { key: "general", label: "General", icon: "help-circle-outline" },
  { key: "bug", label: "Bug Report", icon: "bug-outline" },
  { key: "account", label: "Account Issue", icon: "person-circle-outline" },
  { key: "abuse", label: "Report Abuse", icon: "warning-outline" },
  { key: "billing", label: "Billing", icon: "card-outline" },
] as const;

const SUPPORT_EMAIL = "whisper.anonymous.app@gmail.com";

/**
 * Contact Support — the native port of the web app's `/contact-support`.
 *
 * The form composes an email; it does not send one. That is the web page's
 * own design — support runs on a mailbox, not a ticket table, so the honest
 * native port hands the same composed message to the OS mail app via
 * `mailto:` and says exactly what happened. Nothing is transmitted by this
 * screen, which is why the submitted state says "should have opened" rather
 * than "was sent".
 */
export default function ContactSupport() {
  const router = useRouter();

  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [category, setCategory] = useState<string>("general");
  const [submitted, setSubmitted] = useState(false);

  const submit = useCallback(() => {
    if (!subject.trim() || !message.trim()) return;
    vibrate();

    const categoryLabel = CATEGORIES.find((c) => c.key === category)?.label || "General";
    const body = `Category: ${categoryLabel}\n\n${message.trim()}`;
    const url = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject.trim())}&body=${encodeURIComponent(body)}`;

    void Linking.openURL(url).catch(() => {});
    setSubmitted(true);
  }, [category, message, subject]);

  const reset = useCallback(() => {
    setSubmitted(false);
    setSubject("");
    setMessage("");
    setCategory("general");
  }, []);

  return (
    <Screen edges={["top", "left", "right"]}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <Pressable onPress={() => router.back()} style={styles.back} hitSlop={12}>
          <Ionicons name="chevron-back" size={24} color={COLORS.text} />
        </Pressable>

        <View style={styles.hero}>
          <View style={styles.heroMark}>
            <Ionicons name="headset-outline" size={30} color={COLORS.purple} />
          </View>
          <Text style={styles.title}>Contact Support</Text>
          <Text style={styles.subtitle}>We usually reply within 24-48 hours.</Text>
        </View>

        {submitted ? (
          <View style={[styles.card, styles.doneCard]}>
            <Ionicons name="checkmark-circle" size={46} color="#4ade80" />
            <Text style={styles.doneTitle}>Message ready to send</Text>
            <Text style={styles.doneBody}>
              Your email app should have opened with your message ready to send.
            </Text>
            <GradientButton label="Write another" variant="glass" onPress={reset} style={styles.doneCta} />
          </View>
        ) : (
          <View style={styles.card}>
            <Text style={styles.label}>What&apos;s it about?</Text>
            <View style={styles.chips}>
              {CATEGORIES.map((c) => {
                const on = category === c.key;
                return (
                  <Pressable
                    key={c.key}
                    accessibilityRole="button"
                    onPress={() => {
                      vibrate();
                      setCategory(c.key);
                    }}
                    style={[styles.chip, on && styles.chipOn]}
                  >
                    <Ionicons name={c.icon} size={13} color={on ? COLORS.text : COLORS.subtle} />
                    <Text style={[styles.chipText, on && styles.chipTextOn]}>{c.label}</Text>
                  </Pressable>
                );
              })}
            </View>

            <Field
              label="Subject"
              icon="create-outline"
              value={subject}
              onChangeText={setSubject}
              placeholder="One line about the problem"
              autoCapitalize="sentences"
              maxLength={140}
            />

            <Field
              label="Message"
              icon="chatbubble-outline"
              value={message}
              onChangeText={setMessage}
              placeholder="Tell us what happened — include usernames, screenshots' details, anything that helps."
              multiline
              maxLength={4000}
              autoCapitalize="sentences"
            />

            <GradientButton
              label="Open email app"
              icon="mail-outline"
              disabled={!subject.trim() || !message.trim()}
              onPress={submit}
              style={styles.cta}
            />

            <Text style={styles.note}>
              This opens your email app with everything filled in — nothing is sent until you tap
              send there.
            </Text>
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: 18, paddingBottom: 48, gap: 16 },

  back: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 18,
    marginLeft: -8,
    backgroundColor: "rgba(23,18,42,0.55)",
    borderWidth: 1,
    borderColor: GLASS.border,
  },

  hero: { alignItems: "center", gap: 8 },
  heroMark: {
    width: 64,
    height: 64,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(139,92,246,0.14)",
    borderWidth: 1,
    borderColor: GLASS.border,
  },
  title: { color: COLORS.text, fontSize: 24, fontWeight: "900" },
  subtitle: { color: COLORS.muted, fontSize: 13.5, textAlign: "center" },

  card: {
    padding: 16,
    gap: 14,
    borderRadius: RADIUS.xl,
    backgroundColor: GLASS.background,
    borderWidth: 1,
    borderColor: GLASS.border,
    ...CARD_SHADOW,
  },

  label: { color: COLORS.muted, fontSize: 12.5, fontWeight: "800", marginBottom: -6 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingVertical: 7,
    paddingHorizontal: 11,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: GLASS.border,
    backgroundColor: "rgba(23,18,42,0.55)",
  },
  chipOn: { borderColor: "rgba(34,211,238,0.4)", backgroundColor: "rgba(34,211,238,0.12)" },
  chipText: { color: COLORS.subtle, fontSize: 12, fontWeight: "800" },
  chipTextOn: { color: COLORS.text },

  cta: { marginTop: 4 },
  note: { color: COLORS.subtle, fontSize: 11.5, lineHeight: 16, textAlign: "center" },

  doneCard: { alignItems: "center", gap: 10, paddingVertical: 30 },
  doneTitle: { color: COLORS.text, fontSize: 19, fontWeight: "900" },
  doneBody: { color: COLORS.muted, fontSize: 13, lineHeight: 19, textAlign: "center", maxWidth: 280 },
  doneCta: { marginTop: 6, maxWidth: 260 },
});
