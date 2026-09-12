import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import Animated, { FadeInDown, FadeOutDown } from "react-native-reanimated";

import { GradientButton } from "@/components/GradientButton";
import { GhostMark } from "@/components/Logo";
import { supabase } from "@/lib/supabase";
import { vibrate } from "@/lib/haptics";
import { COLORS, FILLS, RADIUS, useStyles } from "@/lib/theme";

/**
 * The "Before you whisper..." modal — the native port of the web app's
 * `components/TermsModal.tsx`, copy for copy.
 *
 * The dashboard shows it once per session (their `sessionStorage` flag is a
 * module flag here — the native session IS the JS context); accepting writes
 * `profiles.terms_accepted = true`. It is a promise the community holds the
 * app to, not a legal trap: there is no way to use Whisper without seeing it
 * once, and no way to miss what it asks.
 */

/** The web's three agreements, verbatim. */
const AGREEMENTS: { icon: keyof typeof Ionicons.glyphMap; color: string; text: string }[] = [
  {
    icon: "heart-outline",
    color: COLORS.cyan,
    text: "Be kind. Anonymous doesn't mean cruel — treat every whisper the way you'd want to be treated.",
  },
  {
    icon: "ban-outline",
    color: COLORS.violet,
    text: "No harassment, threats, hate speech, or content meant to harm, expose, or embarrass someone.",
  },
  {
    icon: "shield-checkmark-outline",
    color: COLORS.cyan,
    text: "Whisper isn't a place for scandals, rumors, or targeting anyone. It's for honest, respectful connection.",
  },
];

export default function TermsModal({ onAccept }: { onAccept: () => void }) {
  const styles = useStyles(makeStyles);
  const [loading, setLoading] = useState(false);

  async function handleAccept() {
    setLoading(true);
    vibrate("success");

    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (session) {
      await supabase.from("profiles").update({ terms_accepted: true }).eq("id", session.user.id);
    }

    setLoading(false);
    onAccept();
  }

  return (
    <Modal transparent visible animationType="fade" onRequestClose={() => {}}>
      <View style={styles.scrim}>
        <Animated.View entering={FadeInDown.duration(320)} exiting={FadeOutDown.duration(200)} style={styles.card}>
          <View style={styles.head}>
            <View style={styles.markWrap}>
              <GhostMark size={34} />
            </View>
            <Text style={styles.title}>Before you whisper...</Text>
            <Text style={styles.sub}>Whisper is built on honesty and respect. By continuing, you agree to:</Text>
          </View>

          <View style={styles.rows}>
            {AGREEMENTS.map((row) => (
              <View key={row.text} style={styles.row}>
                <View style={[styles.rowMark, { backgroundColor: `${row.color}33` }]}>
                  <Ionicons name={row.icon} size={15} color={row.color} />
                </View>
                <Text style={styles.rowText}>{row.text}</Text>
              </View>
            ))}
          </View>

          <GradientButton
            label={loading ? "Confirming..." : "I Agree — Let's Whisper"}
            fullWidth
            size="lg"
            loading={loading}
            disabled={loading}
            onPress={() => void handleAccept()}
            style={styles.button}
          />

          <Text style={styles.footnote}>Violating these guidelines may result in account suspension.</Text>
        </Animated.View>
      </View>
    </Modal>
  );
}

const makeStyles = () =>
  StyleSheet.create({
    scrim: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.85)",
      alignItems: "center",
      justifyContent: "center",
      padding: 20,
    },
    card: {
      width: "100%",
      maxWidth: 380,
      borderRadius: RADIUS.xxxl,
      borderWidth: 1,
      borderColor: COLORS.border,
      backgroundColor: COLORS.card,
      padding: 28,
    },
    head: { alignItems: "center", gap: 8 },
    markWrap: {
      width: 52,
      height: 52,
      borderRadius: 26,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: COLORS.surface,
    },
    title: { color: COLORS.text, fontSize: 20, fontWeight: "900", textAlign: "center" },
    sub: { color: COLORS.subtle, fontSize: 13, textAlign: "center", lineHeight: 19 },

    rows: { gap: 16, marginTop: 22 },
    row: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
    rowMark: {
      width: 30,
      height: 30,
      borderRadius: 15,
      alignItems: "center",
      justifyContent: "center",
      marginTop: 1,
    },
    rowText: { flex: 1, color: COLORS.muted, fontSize: 13.5, lineHeight: 20 },

    button: { marginTop: 26 },
    footnote: {
      color: COLORS.subtle,
      fontSize: 11.5,
      textAlign: "center",
      marginTop: 12,
      lineHeight: 16,
    },
  });
