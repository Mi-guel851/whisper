import Ionicons from "@expo/vector-icons/Ionicons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { Screen } from "@/components/Screen";
import { LEGAL_PAGES, legalPageBySlug } from "@/lib/legal";
import { COLORS, GLASS, RADIUS, useStyles } from "@/lib/theme";

/**
 * The legal pages — Privacy Policy, Terms of Service, Community Guidelines.
 *
 * One renderer, three documents: the text lives in `lib/legal.ts`, extracted
 * verbatim from the web app's pages, and this screen draws whichever slug the
 * route carries (`/legal?slug=terms`). The words users agree to must not
 * differ between the site and the phone — the complete-profile consent tick
 * references these exact documents, and a client-local copy of a legal text
 * is how the two copies drift.
 *
 * Sections render collapsed, like the web pages' own feel of one card per
 * section — on a phone a fully-open 12-section policy is a scroll maroon, and
 * a person looking for "Data Retention" taps rather than scrolls.
 */
export default function Legal() {
  const styles = useStyles(makeStyles);
  const router = useRouter();
  const params = useLocalSearchParams<{ slug?: string }>();

  const page = useMemo(() => {
    return legalPageBySlug(params.slug ?? "privacy") ?? LEGAL_PAGES[0];
  }, [params.slug]);

  const [openIdx, setOpenIdx] = useState<number | null>(null);

  return (
    <Screen edges={["top", "left", "right"]}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Pressable onPress={() => router.back()} style={styles.back} hitSlop={12}>
          <Ionicons name="chevron-back" size={24} color={COLORS.text} />
        </Pressable>

        <View style={styles.hero}>
          <Text style={styles.eyebrow}>{page.eyebrow}</Text>
          <Text style={styles.title}>{page.title}</Text>
          <Text style={styles.subtitle}>
            The same document that lives on the web — nothing here is the app&apos;s own edit.
          </Text>
        </View>

        <View style={styles.sections}>
          {page.sections.map((section, idx) => {
            const open = openIdx === idx;
            return (
              <View key={section.title} style={styles.section}>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setOpenIdx(open ? null : idx)}
                  style={styles.sectionHead}
                >
                  <View style={styles.sectionMarker} />
                  <Text style={styles.sectionTitle}>{section.title}</Text>
                  <Ionicons
                    name="chevron-down"
                    size={16}
                    color={COLORS.subtle}
                    style={open ? styles.chevronOn : undefined}
                  />
                </Pressable>
                {open ? <Text style={styles.sectionBody}>{section.body}</Text> : null}
              </View>
            );
          })}
        </View>

        <Text style={styles.footer}>
          Questions about this document? Reach us at whisper.anonymous.app@gmail.com or through
          Contact Support.
        </Text>
      </ScrollView>
    </Screen>
  );
}

const makeStyles = () => StyleSheet.create({
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

  hero: { gap: 4 },
  eyebrow: {
    color: COLORS.purple,
    fontSize: 11.5,
    fontWeight: "900",
    letterSpacing: 1.4,
    textTransform: "uppercase",
  },
  title: { color: COLORS.text, fontSize: 26, fontWeight: "900" },
  subtitle: { color: COLORS.muted, fontSize: 13, lineHeight: 19 },

  sections: { gap: 9 },
  section: {
    borderRadius: RADIUS.lg,
    backgroundColor: GLASS.background,
    borderWidth: 1,
    borderColor: GLASS.border,
    overflow: "hidden",
  },
  sectionHead: { flexDirection: "row", alignItems: "center", gap: 10, padding: 14 },
  sectionMarker: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: "rgba(139,92,246,0.7)",
  },
  sectionTitle: { flex: 1, color: COLORS.text, fontSize: 14, fontWeight: "800", lineHeight: 19 },
  chevronOn: { transform: [{ rotate: "180deg" }] },
  sectionBody: {
    paddingHorizontal: 14,
    paddingBottom: 14,
    paddingLeft: 31,
    color: COLORS.muted,
    fontSize: 13,
    lineHeight: 21,
  },

  footer: {
    color: COLORS.subtle,
    fontSize: 11.5,
    lineHeight: 17,
    textAlign: "center",
    paddingHorizontal: 12,
  },
});
