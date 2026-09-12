import Ionicons from "@expo/vector-icons/Ionicons";
import { useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { Field } from "@/components/Input";
import { GradientButton } from "@/components/GradientButton";
import { Screen } from "@/components/Screen";
import { vibrate } from "@/lib/haptics";
import { CARD_SHADOW, COLORS, GLASS, RADIUS } from "@/lib/theme";

const FEEDBACK_EMAIL = "whisper.anonymous.app@gmail.com";

/**
 * Feedback — the native port of the web app's `/feedback`.
 *
 * A star rating and a message box, composed into an email exactly as the web
 * page composes it (`Rating: n / 5`, a blank line, the message) and handed to
 * the OS mail app. Unrated is a valid choice — the body says "Not rated"
 * rather than blocking submit, because a sentence of feedback with no stars
 * still beats no feedback.
 */
export default function Feedback() {
  const router = useRouter();

  const [rating, setRating] = useState(0);
  const [message, setMessage] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const submit = useCallback(() => {
    if (!message.trim()) return;
    vibrate();

    const body = `Rating: ${rating || "Not rated"} / 5\n\n${message.trim()}`;
    const url = `mailto:${FEEDBACK_EMAIL}?subject=${encodeURIComponent(
      "Whisper App Feedback"
    )}&body=${encodeURIComponent(body)}`;

    void Linking.openURL(url).catch(() => {});
    setSubmitted(true);
  }, [message, rating]);

  const reset = useCallback(() => {
    setSubmitted(false);
    setRating(0);
    setMessage("");
  }, []);

  return (
    <Screen edges={["top", "left", "right"]}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <Pressable onPress={() => router.back()} style={styles.back} hitSlop={12}>
          <Ionicons name="chevron-back" size={24} color={COLORS.text} />
        </Pressable>

        <View style={styles.hero}>
          <View style={styles.heroMark}>
            <Ionicons name="bulb-outline" size={30} color={COLORS.purple} />
          </View>
          <Text style={styles.title}>Feedback</Text>
          <Text style={styles.subtitle}>Tell us what&apos;s working and what could be better.</Text>
        </View>

        {submitted ? (
          <View style={[styles.card, styles.doneCard]}>
            <Ionicons name="checkmark-circle" size={46} color="#4ade80" />
            <Text style={styles.doneTitle}>Thanks for the feedback!</Text>
            <Text style={styles.doneBody}>
              Your email app should have opened with your message ready to send.
            </Text>
            <GradientButton label="Send more" variant="glass" onPress={reset} style={styles.doneCta} />
          </View>
        ) : (
          <View style={styles.card}>
            <Text style={styles.label}>How&apos;s Whisper so far?</Text>
            <View style={styles.stars}>
              {[1, 2, 3, 4, 5].map((star) => (
                <Pressable
                  key={star}
                  accessibilityRole="button"
                  accessibilityLabel={`Rate ${star} out of 5`}
                  onPress={() => {
                    vibrate();
                    setRating(star);
                  }}
                  hitSlop={6}
                  style={styles.starBtn}
                >
                  <Ionicons
                    name={star <= rating ? "star" : "star-outline"}
                    size={32}
                    color={star <= rating ? "#fbbf24" : COLORS.subtle}
                  />
                </Pressable>
              ))}
            </View>

            <Field
              label="Your feedback"
              icon="chatbubble-ellipses-outline"
              value={message}
              onChangeText={setMessage}
              placeholder="Suggestions, feature requests, things you love or hate..."
              multiline
              maxLength={4000}
              autoCapitalize="sentences"
            />

            <GradientButton
              label="Open email app"
              icon="mail-outline"
              disabled={!message.trim()}
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
  subtitle: { color: COLORS.muted, fontSize: 13.5, textAlign: "center", maxWidth: 300 },

  card: {
    padding: 16,
    gap: 14,
    borderRadius: RADIUS.xl,
    backgroundColor: GLASS.background,
    borderWidth: 1,
    borderColor: GLASS.border,
    ...CARD_SHADOW,
  },

  label: { color: COLORS.muted, fontSize: 12.5, fontWeight: "800" },
  stars: { flexDirection: "row", justifyContent: "center", gap: 10, marginTop: -4 },
  starBtn: { padding: 2 },

  cta: { marginTop: 4 },
  note: { color: COLORS.subtle, fontSize: 11.5, lineHeight: 16, textAlign: "center" },

  doneCard: { alignItems: "center", gap: 10, paddingVertical: 30 },
  doneTitle: { color: COLORS.text, fontSize: 19, fontWeight: "900" },
  doneBody: { color: COLORS.muted, fontSize: 13, lineHeight: 19, textAlign: "center", maxWidth: 280 },
  doneCta: { marginTop: 6, maxWidth: 260 },
});
