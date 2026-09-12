import Ionicons from "@expo/vector-icons/Ionicons";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";

import { Screen } from "@/components/Screen";
import { CARD_SHADOW, COLORS, GLASS, RADIUS, useStyles } from "@/lib/theme";

/* The help-center content, verbatim from the web app's `/help-center` page —
   the same four guides and the same eight answers, because an answer that
   differs between the site and the phone is one of them wrong. */

const GUIDES = [
  { icon: "send-outline", title: "Sending Messages", desc: "Attach images and craft anonymous messages through any Whisper link." },
  { icon: "person-outline", title: "Setting Up Your Profile", desc: "Customize your username, display name, avatar, and bio." },
  { icon: "notifications-outline", title: "Managing Notifications", desc: "Control push notifications and sound alerts in Settings." },
  { icon: "chatbubble-outline", title: "Direct Messages", desc: "Start conversations with other users in your Inbox." },
] as const;

const FAQS = [
  { q: "How do I create my anonymous link?", a: "After registering, go to your Profile page and set a username. Your shareable link will be generated automatically in the format whisper.app/u/yourusername. Share it anywhere to start receiving anonymous messages." },
  { q: "Can senders see who I am?", a: "No. When someone sends a message through your Whisper link, their identity is never shared with you. The same applies when you send messages to others — your identity remains private." },
  { q: "Can I pin a message?", a: "Yes, inside a chat. Open the conversation, press and hold the message you want to pin, and choose Pin — you'll be asked how long it should stay pinned. Pinned messages appear in a bar at the top of that chat. Anonymous whispers on the Whispers tab can't be pinned or favorited." },
  { q: "Can I attach images to messages?", a: "Yes. When sending a message through a Whisper link, you can optionally attach an image. Images are processed and displayed anonymously alongside the message text." },
  { q: "Someone is harassing me. What can I do?", a: "Open Contact Support and choose Report Abuse. Include as much detail as you can — our moderation team reviews every report. You can also delete any whisper from the Whispers tab, which removes it and its image permanently. Sender hints show a whisper's approximate location, time and device, but never a name — Whisper has no feature that reveals who sent an anonymous message." },
  { q: "What are Whisper Coins?", a: "Whisper Coins are virtual currency used to unlock premium features and profile enhancements. Visit the Coin Store to purchase coins or check your balance on the dashboard." },
  { q: "How do I delete my account?", a: "Go to Settings and scroll to the bottom. Logging out signs you out of the current session. For full account deletion, please contact support through the Contact Support page." },
  { q: "Is my data secure?", a: "Yes. All data in transit is encrypted with TLS. Passwords are hashed and never stored in plain text. See our Privacy Policy for full details on data handling and retention." },
];

/**
 * Help Center — the native port of the web app's `/help-center`.
 *
 * Four "what does Whisper do" guides in a two-column grid, then the FAQ as an
 * accordion. One question open at a time, like the web page's single `openIdx`
 * — an FAQ where every answer is already open is a wall of text, and one where
 * three are open at once has no reading order.
 */
export default function Help() {
  const styles = useStyles(makeStyles);
  const router = useRouter();
  const [openIdx, setOpenIdx] = useState<number | null>(null);

  return (
    <Screen edges={["top", "left", "right"]}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Pressable onPress={() => router.back()} style={styles.back} hitSlop={12}>
          <Ionicons name="chevron-back" size={24} color={COLORS.text} />
        </Pressable>

        <View style={styles.hero}>
          <View style={styles.heroMark}>
            <Ionicons name="help-circle" size={30} color={COLORS.purple} />
          </View>
          <Text style={styles.title}>Help Center</Text>
          <Text style={styles.subtitle}>Guides and answers to get the most out of Whisper.</Text>
        </View>

        <View style={styles.guides}>
          {GUIDES.map((guide, index) => (
            <Animated.View
              key={guide.title}
              entering={FadeInDown.delay(index * 55).springify().damping(16)}
              style={styles.guideWrap}
            >
              <View style={styles.guideCard}>
                <Ionicons name={guide.icon} size={20} color={COLORS.purple} />
                <Text style={styles.guideTitle}>{guide.title}</Text>
                <Text style={styles.guideDesc}>{guide.desc}</Text>
              </View>
            </Animated.View>
          ))}
        </View>

        <Text style={styles.faqHeading}>Frequently Asked Questions</Text>
        <View style={styles.faqList}>
          {FAQS.map((faq, idx) => {
            const open = openIdx === idx;
            return (
              <View key={faq.q} style={styles.faqCard}>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setOpenIdx(open ? null : idx)}
                  style={styles.faqHead}
                >
                  <Text style={styles.faqQ}>{faq.q}</Text>
                  <Ionicons
                    name="chevron-down"
                    size={17}
                    color={COLORS.subtle}
                    style={open ? styles.faqChevronOn : undefined}
                  />
                </Pressable>
                {open ? <Text style={styles.faqA}>{faq.a}</Text> : null}
              </View>
            );
          })}
        </View>
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

  hero: { alignItems: "center", gap: 8, marginTop: 4 },
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

  guides: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  guideWrap: { width: "48.5%", flexGrow: 1 },
  guideCard: {
    flex: 1,
    padding: 13,
    gap: 6,
    borderRadius: RADIUS.lg,
    backgroundColor: GLASS.background,
    borderWidth: 1,
    borderColor: GLASS.border,
    ...CARD_SHADOW,
  },
  guideTitle: { color: COLORS.text, fontSize: 13, fontWeight: "800" },
  guideDesc: { color: COLORS.subtle, fontSize: 11.5, lineHeight: 16 },

  faqHeading: { color: COLORS.text, fontSize: 18, fontWeight: "900", marginBottom: -6 },
  faqList: { gap: 10 },
  faqCard: {
    borderRadius: RADIUS.lg,
    backgroundColor: GLASS.background,
    borderWidth: 1,
    borderColor: GLASS.border,
    overflow: "hidden",
  },
  faqHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, padding: 14 },
  faqQ: { flex: 1, color: COLORS.text, fontSize: 13.5, fontWeight: "800", lineHeight: 19 },
  faqChevronOn: { transform: [{ rotate: "180deg" }] },
  faqA: { paddingHorizontal: 14, paddingBottom: 14, color: COLORS.muted, fontSize: 13, lineHeight: 20 },
});
