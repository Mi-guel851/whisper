import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from "react-native";
import MaskedView from "@react-native-masked-view/masked-view";
import { LinearGradient } from "expo-linear-gradient";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Background } from "@/components/Background";
import { markOnboarded } from "@/lib/firstRun";
import { vibrate } from "@/lib/haptics";
import { BLOBS, COLORS, FILLS, HAIRLINE, RADIUS, useStyles } from "@/lib/theme";

/**
 * Onboarding — the native port of the web landing page (`app/page.tsx` +
 * `components/Hero.tsx` + `components/HowItWorks.tsx`), the first screen a
 * new user sees.
 *
 * WHAT CARRIES OVER, EXACTLY
 *
 *   - the eyebrow pill: pulsing brand-cyan dot + "100% Anonymous. Always."
 *     (the web's `.home-pill`: hairline border, `--fill-1`, xs weight 700);
 *   - the headline "Honest conversations start with Whisper." entering word
 *     by word ({opacity 0, y .35em, blur} → settled, .66s, outExpo, i×.075)
 *     with "Whisper." carrying the SpecialText highlight — the same 6-stop
 *     gradient, travelled by animating the gradient under the text mask
 *     (the native translation of `background-position`);
 *   - the sub copy, verbatim;
 *   - "Create My Link" on the premium purple→pink gradient (the web's
 *     `.premium-button-primary`), ArrowRight, routing to signup as the web
 *     hero does;
 *   - "See how it works" outline with the Play glyph, scrolling to the
 *     four-step strip below — the same STEPS copy the web section carries;
 *   - the social proof: three overlapping generated avatars (the web home
 *     page's own seed→gradient algorithm) and the 120,000+ count-up.
 *
 * WHAT DELIBERATELY STAYS WEB-ONLY
 *
 * The phone mockup + orbit chips (a 3D device render for desktop folds), the
 * "Download Android app" lockup (meaningless inside the app), and the
 * testimonials/footer marketing bulk — the landing can hold all nine sections
 * at 1280px; a first-run phone screen holds the pitch, the proof and the two
 * doors. A signed-in user never sees this screen at all: the (auth) layout
 * redirects them before it paints.
 */

const LEAD = "Honest conversations start with";
const ACCENT = "Whisper.";

/** The web hero's social-proof seeds, one for one. */
const PROOF = ["@its_joycee", "@real_kayz", "@mimi.vibes"];
const PROOF_COUNT = 120_000;

const STEPS = [
  {
    icon: "link-outline" as const,
    title: "Create your link",
    desc: "Sign up in seconds and get your own unique Whisper link instantly.",
  },
  {
    icon: "share-social-outline" as const,
    title: "Share it anywhere",
    desc: "Drop it in your Instagram bio, TikTok, or Snapchat story — wherever your people are.",
  },
  {
    icon: "mail-outline" as const,
    title: "Receive messages",
    desc: "Anonymous messages, photos and voice notes land in your inbox in real time.",
  },
  {
    icon: "sparkles-outline" as const,
    title: "Reply and react",
    desc: "Answer back, react with an emoji, and share the best ones to your story.",
  },
];

/** FNV-1a over the seed — the web home Avatar's exact hash. */
function hash(seed: string) {
  let value = 0x811c9dc5;
  for (let i = 0; i < seed.length; i += 1) {
    value ^= seed.charCodeAt(i);
    value = Math.imul(value, 0x01000193);
  }
  return value >>> 0;
}

/** Hue pairs sampled around the brand triad — the web's RAMPS, one for one. */
const RAMPS: ReadonlyArray<readonly [number, number]> = [
  [265, 315],
  [330, 285],
  [190, 255],
  [225, 280],
  [300, 200],
  [250, 195],
];

/** One generated identity avatar — `hsl(from 82% 62%) → hsl(to 78% 52%)`. */
function ProofAvatar({ seed, size }: { seed: string; size: number }) {
  const digest = hash(seed);
  const [from, to] = RAMPS[digest % RAMPS.length];
  const initial = seed.replace(/^@/, "").charAt(0).toUpperCase();
  return (
    <LinearGradient
      colors={[`hsl(${from} 82% 62%)`, `hsl(${to} 78% 52%)`]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        alignItems: "center",
        justifyContent: "center",
        borderWidth: 2,
        borderColor: COLORS.background,
      }}
    >
      <Text style={{ color: "#ffffff", fontWeight: "900", fontSize: Math.round(size * 0.4) }}>{initial}</Text>
    </LinearGradient>
  );
}

/**
 * The SpecialText highlight: the web's 6-stop gradient (100deg: accent-from →
 * purple → white → pink → purple → accent-from) slid under a text mask. One
 * pass every 6 seconds, `--ease-soft`; a negative start phase per word makes
 * the band read as one sweep crossing the headline.
 */
function SweepText({ text, style, phaseOffset = 0 }: { text: string; style: StyleProp<TextStyle>; phaseOffset?: number }) {
  const styles = useStyles(makeStyles);
  const width = useSharedValue(0);
  const progress = useSharedValue(0);

  useEffect(() => {
    if (width.value === 0) return;
    progress.value = -phaseOffset;
    progress.value = withDelay(
      0,
      withRepeat(
        withSequence(
          withTiming(1, { duration: 6_000 * (1 - phaseOffset), easing: Easing.bezier(0.65, 0, 0.35, 1) }),
          withTiming(0, { duration: 0 })
        ),
        -1,
        false
      )
    );
  }, [phaseOffset, progress, width.value]);

  const translate = useAnimatedStyle(() => ({
    transform: [{ translateX: -progress.value * width.value * 1.6 }],
  }));

  return (
    <View
      onLayout={(event) => {
        width.value = event.nativeEvent.layout.width;
      }}
    >
      <MaskedView maskElement={<Text style={[styles.baseText, style]}>{text}</Text>}>
        <View style={{ height: Math.round((style as { fontSize?: number }).fontSize ?? 34) * 1.4, overflow: "hidden" }}>
          <Animated.View style={[styles.sweepStrip, translate]}>
            <LinearGradient
              colors={[COLORS.cyan, COLORS.violet, "#ffffff", COLORS.pink, COLORS.violet, COLORS.cyan]}
              locations={[0, 0.26, 0.42, 0.58, 0.82, 1]}
              start={{ x: 0, y: 0.5 }}
              end={{ x: 1, y: 0.5 }}
              style={{ flex: 1 }}
            >
              <Text style={[styles.baseText, style, styles.invisible]}>{text}</Text>
            </LinearGradient>
          </Animated.View>
        </View>
      </MaskedView>
    </View>
  );
}

/** One headline word: the web AnimatedHeading's entrance, per word. */
function HeroWord({ word, index, accent }: { word: string; index: number; accent: boolean }) {
  const styles = useStyles(makeStyles);
  const opacity = useSharedValue(0);
  const y = useSharedValue(14);

  useEffect(() => {
    opacity.value = withDelay(index * 75, withTiming(1, { duration: 660, easing: Easing.bezier(0.16, 1, 0.3, 1) }));
    y.value = withDelay(index * 75, withTiming(0, { duration: 660, easing: Easing.bezier(0.16, 1, 0.3, 1) }));
  }, [index, opacity, y]);

  const style = useAnimatedStyle(() => ({ opacity: opacity.value, transform: [{ translateY: y.value }] }));

  return (
    <Animated.View style={style as unknown as StyleProp<ViewStyle>}>
      {accent ? (
        <SweepText text={word} style={styles.headlineAccent} />
      ) : (
        <Text style={styles.headline}>{word}</Text>
      )}
    </Animated.View>
  );
}

/** The eyebrow pill's pulse dot — scale [1,2.4,1], opacity [.55,0,.55], 2.4s. */
function PulseDot() {
  const styles = useStyles(makeStyles);
  const scale = useSharedValue(1);
  const opacity = useSharedValue(0.55);

  useEffect(() => {
    scale.value = withRepeat(
      withSequence(withTiming(2.4, { duration: 1_200, easing: Easing.out(Easing.quad) }), withTiming(1, { duration: 1_200, easing: Easing.out(Easing.quad) })),
      -1,
      false
    );
    opacity.value = withRepeat(
      withSequence(withTiming(0, { duration: 1_200, easing: Easing.out(Easing.quad) }), withTiming(0.55, { duration: 1_200, easing: Easing.out(Easing.quad) })),
      -1,
      false
    );
  }, [opacity, scale]);

  const halo = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }], opacity: opacity.value }));

  return (
    <View style={styles.dotWrap}>
      <Animated.View style={[styles.dotHalo, halo]} />
      <View style={styles.dot} />
    </View>
  );
}

/** The 120,000+ count-up — the web CountUp's 1.5s roll on mount. */
function CountUp() {
  const styles = useStyles(makeStyles);
  const [value, setValue] = useState(0);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const start = Date.now();
    const timer = setInterval(() => {
      const t = Math.min(1, (Date.now() - start) / 1_500);
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(Math.round(PROOF_COUNT * eased));
      if (t >= 1) clearInterval(timer);
    }, 33);
    return () => clearInterval(timer);
  }, []);

  return <Text style={styles.proofCount}>{value.toLocaleString()}+</Text>;
}

export default function Onboarding() {
  const styles = useStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const howY = useRef(0);
  const scrollRef = useRef<ScrollView | null>(null);

  const words = useMemo(() => [...LEAD.split(" "), ACCENT], []);

  const start = () => {
    vibrate("tap");
    void markOnboarded();
    router.replace("/(auth)/signup");
  };

  const scrollToHow = () => {
    vibrate("tap");
    scrollRef.current?.scrollTo({ y: Math.max(0, howY.current - 60), animated: true });
  };

  return (
    <View style={styles.root}>
      <Background />
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={[
          styles.scroll,
          { paddingTop: insets.top + 48, paddingBottom: Math.max(insets.bottom, 24) + 36 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* --- Navbar (web Navbar.tsx, mobile fold) --- */}
        <View style={styles.nav}>
          <Text style={styles.navMark}>Whisper</Text>
          <View style={styles.navActions}>
            <Pressable
              onPress={() => {
                vibrate("tap");
                void markOnboarded();
                router.replace("/(auth)/login");
              }}
              accessibilityRole="button"
              accessibilityLabel="Login"
              style={({ pressed }) => [styles.navGhost, pressed && styles.ctaPressed]}
            >
              <Text style={styles.navGhostText}>Login</Text>
            </Pressable>
            <Pressable
              onPress={start}
              accessibilityRole="button"
              accessibilityLabel="Start Whispering"
              style={({ pressed }) => [styles.navCta, pressed && styles.ctaPressed]}
            >
              <LinearGradient
                colors={[COLORS.violet, COLORS.pink]}
                start={{ x: 0, y: 0.5 }}
                end={{ x: 1, y: 0.5 }}
                style={styles.navCtaFill}
              >
                <Text style={styles.navCtaText}>Start</Text>
              </LinearGradient>
            </Pressable>
          </View>
        </View>

        {/* --- The hero (web Hero.tsx) --- */}
        <View style={[styles.pill, styles.pillHero]}>
          <PulseDot />
          <Text style={styles.pillText}>100% Anonymous. Always.</Text>
        </View>

        <View style={styles.headlineWrap}>
          {words.map((word, index) => (
            <View key={`${word}-${index}`} style={styles.wordWrap}>
              <HeroWord word={word} index={index} accent={word === ACCENT} />
              {index < words.length - 1 ? <Text style={styles.headline}> </Text> : null}
            </View>
          ))}
        </View>

        <Text style={styles.sub}>
          Receive anonymous messages, photos, voice notes and reactions from the people who know you — completely
          honestly.
        </Text>

        <View style={styles.ctas}>
          <Pressable
            onPress={start}
            accessibilityRole="button"
            accessibilityLabel="Create My Link"
            style={({ pressed }) => [styles.primaryCta, pressed && styles.ctaPressed]}
          >
            <LinearGradient
              colors={[COLORS.violet, COLORS.pink]}
              start={{ x: 0, y: 0.5 }}
              end={{ x: 1, y: 0.5 }}
              style={styles.primaryCtaFill}
            >
              <Text style={styles.primaryCtaText}>Create My Link</Text>
              <Ionicons name="arrow-forward" size={17} color={COLORS.contrast} />
            </LinearGradient>
          </Pressable>

          <Pressable
            onPress={scrollToHow}
            accessibilityRole="button"
            accessibilityLabel="See how it works"
            style={({ pressed }) => [styles.outlineCta, pressed && styles.ctaPressed]}
          >
            <Ionicons name="play" size={13} color={COLORS.text} />
            <Text style={styles.outlineCtaText}>See how it works</Text>
          </Pressable>
        </View>

        {/* --- Social proof --- */}
        <View style={styles.proof}>
          <View style={styles.proofStack}>
            {PROOF.map((seed, index) => (
              <View key={seed} style={index === 0 ? undefined : styles.proofOverlap}>
                <ProofAvatar seed={seed} size={34} />
              </View>
            ))}
          </View>
          <View style={styles.proofText}>
            <CountUp />
            <Text style={styles.proofLabel}>messages sent today</Text>
          </View>
        </View>

        {/* --- How it works (web HowItWorks.tsx) --- */}
        <View
          onLayout={(event) => {
            howY.current = event.nativeEvent.layout.y;
          }}
          style={styles.how}
        >
          <Text style={styles.eyebrow}>Live in under a minute</Text>
          <Text style={styles.howTitle}>
            How it <Text style={styles.howAccent}>works.</Text>
          </Text>
          <Text style={styles.howSub}>Four steps. Zero identity. Nothing to install.</Text>

          <View style={styles.steps}>
            {STEPS.map((step, index) => (
              <View key={step.title} style={styles.step}>
                <View style={styles.stepNode}>
                  <Ionicons name={step.icon} size={19} color={COLORS.text} />
                  <View style={styles.stepBadge}>
                    <Text style={styles.stepBadgeText}>{index + 1}</Text>
                  </View>
                </View>
                <Text style={styles.stepTitle}>{step.title}</Text>
                <Text style={styles.stepDesc}>{step.desc}</Text>
              </View>
            ))}
          </View>
        </View>

        <Pressable onPress={start} accessibilityRole="button" style={styles.closing}>
          <LinearGradient
            colors={[COLORS.violet, COLORS.pink]}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={styles.closingFill}
          >
            <Text style={styles.closingText}>Create My Link</Text>
            <Ionicons name="arrow-forward" size={16} color={COLORS.contrast} />
          </LinearGradient>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const makeStyles = () =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: COLORS.background },
    scroll: { paddingHorizontal: 22 },

    baseText: { color: COLORS.text, fontWeight: "800" },
    invisible: { color: "transparent", position: "absolute" },
    sweepStrip: { width: "260%", height: "100%" },

    nav: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 34 },
    navMark: { color: COLORS.text, fontSize: 19, fontWeight: "900", letterSpacing: -0.5 },
    navActions: { flexDirection: "row", alignItems: "center", gap: 10 },
    navGhost: {
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: RADIUS.pill,
      borderWidth: 1,
      borderColor: COLORS.borderStrong,
      backgroundColor: FILLS[1],
    },
    navGhostText: { color: COLORS.text, fontSize: 13, fontWeight: "700" },
    navCta: { borderRadius: RADIUS.pill, overflow: "hidden" },
    navCtaFill: { paddingHorizontal: 16, paddingVertical: 9, borderRadius: RADIUS.pill },
    navCtaText: { color: COLORS.text, fontSize: 13, fontWeight: "800" },
    pillHero: { marginTop: 26 },
    pill: {
      alignSelf: "flex-start",
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      paddingHorizontal: 14,
      paddingVertical: 7,
      borderRadius: RADIUS.pill,
      borderWidth: 1,
      borderColor: HAIRLINE,
      backgroundColor: FILLS[1],
    },
    pillText: { color: COLORS.muted, fontSize: 12, fontWeight: "700" },
    dotWrap: { width: 8, height: 8, alignItems: "center", justifyContent: "center" },
    dotHalo: { position: "absolute", width: 8, height: 8, borderRadius: 4, backgroundColor: COLORS.cyan },
    dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: COLORS.cyan },

    headlineWrap: { flexWrap: "wrap", flexDirection: "row", marginTop: 18 },
    headline: {
      color: COLORS.text,
      fontSize: 34,
      lineHeight: 38,
      fontWeight: "800",
      letterSpacing: -1,
    },
    headlineAccent: {
      fontSize: 34,
      lineHeight: 38,
      fontWeight: "800",
      letterSpacing: -1,
    },
    wordWrap: { flexDirection: "row" },
    sub: {
      color: COLORS.muted,
      fontSize: 15.5,
      lineHeight: 24,
      marginTop: 18,
      maxWidth: 460,
    },

    ctas: { gap: 12, marginTop: 26 },
    ctaPressed: { opacity: 0.88, transform: [{ scale: 0.985 }] },
    primaryCta: { borderRadius: RADIUS.pill, overflow: "hidden" },
    primaryCtaFill: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      height: 46,
      borderRadius: RADIUS.pill,
    },
    primaryCtaText: { color: COLORS.text, fontSize: 15, fontWeight: "800" },
    outlineCta: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      height: 46,
      borderRadius: RADIUS.pill,
      borderWidth: 1,
      borderColor: COLORS.borderStrong,
      backgroundColor: FILLS[1],
    },
    outlineCtaText: { color: COLORS.text, fontSize: 14.5, fontWeight: "700" },

    proof: { flexDirection: "row", alignItems: "center", gap: 14, marginTop: 30 },
    proofStack: { flexDirection: "row", alignItems: "center" },
    proofOverlap: { marginLeft: -12 },
    proofText: { gap: 1 },
    proofCount: { color: COLORS.text, fontSize: 18, fontWeight: "800" },
    proofLabel: { color: COLORS.subtle, fontSize: 12, fontWeight: "600" },

    how: { marginTop: 64 },
    eyebrow: {
      color: COLORS.subtle,
      fontSize: 11,
      fontWeight: "900",
      letterSpacing: 2,
      textTransform: "uppercase",
    },
    howTitle: { color: COLORS.text, fontSize: 26, fontWeight: "800", letterSpacing: -0.6, marginTop: 6 },
    howAccent: { color: COLORS.violet },
    howSub: { color: COLORS.muted, fontSize: 14, marginTop: 6 },

    steps: { gap: 22, marginTop: 26 },
    step: { gap: 6 },
    stepNode: {
      width: 46,
      height: 46,
      borderRadius: 23,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 1,
      borderColor: COLORS.border,
      backgroundColor: COLORS.card,
    },
    stepBadge: {
      position: "absolute",
      top: -4,
      right: -4,
      width: 18,
      height: 18,
      borderRadius: 9,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: COLORS.violet,
    },
    stepBadgeText: { color: COLORS.text, fontSize: 10.5, fontWeight: "900" },
    stepTitle: { color: COLORS.text, fontSize: 15, fontWeight: "800", marginTop: 4 },
    stepDesc: { color: COLORS.muted, fontSize: 13, lineHeight: 19 },

    closing: { borderRadius: RADIUS.pill, overflow: "hidden", marginTop: 40 },
    closingFill: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      height: 50,
      borderRadius: RADIUS.pill,
    },
    closingText: { color: COLORS.text, fontSize: 15.5, fontWeight: "800" },
  });
