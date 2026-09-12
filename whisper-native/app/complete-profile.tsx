import Ionicons from "@expo/vector-icons/Ionicons";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { Field } from "@/components/Input";
import { GradientButton } from "@/components/GradientButton";
import { Logo } from "@/components/Logo";
import { Screen } from "@/components/Screen";
import { Toggle } from "@/components/Toggle";
import { COUNTRIES, countryNameFromCode, flagFromCode } from "@/lib/countries";
import { grantConsent, hasCurrentConsent } from "@/lib/consent";
import { apiBase } from "@/lib/feed";
import { isProfileComplete, validateUsername, USERNAME_MIN } from "@/lib/profile";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/lib/session";
import { Sheet } from "@/components/Sheet";
import { useToast } from "@/lib/toast";
import { CARD_SHADOW, COLORS, GLASS, RADIUS } from "@/lib/theme";

/**
 * Complete your profile — the native port of the web app's `/complete-profile`.
 *
 * WHY THIS SCREEN EXISTS
 *
 * Email signup stops at a confirmed address: no username, no country, no
 * recovery phrase, no consent row. The database's own trigger blocks messaging
 * until `profile_completed` flips true, and forgot-password can only verify a
 * person whose recovery phrase is set. Both of those happen here, in the same
 * order the web page does them:
 *
 *   Step 1  username (validated the same way, uniqueness checked against the
 *           same query), country + phone number, and the consent tick — which
 *           writes a `consents` row for the current document version through
 *           `record_consent`. The profiles trigger refuses to complete an
 *           account without one, and that is a policy the client must not be
 *           able to talk its way around.
 *   Step 2  the recovery phrase (8+ characters, typed twice on the web's form
 *           as a show-both-fields pair; here it is one field plus an explicit
 *           "I saved it" confirmation, which is the same human check), stored
 *           server-side through `/api/set-recovery-phrase` so the plaintext
 *           never has to survive in the client.
 *
 * The last write is `profiles.profile_completed = true` — the flag the fork on
 * `index` and the auth layout check, so this screen is the only door out.
 */
export default function CompleteProfile() {
  const router = useRouter();
  const { session, userId } = useSession();
  const { showToast } = useToast();

  const [step, setStep] = useState<1 | 2>(1);
  const [checking, setChecking] = useState(true);

  const [username, setUsername] = useState("");
  const [countryCode, setCountryCode] = useState("NG");
  const [phone, setPhone] = useState("");
  const [consented, setConsented] = useState(false);
  const [countrySheet, setCountrySheet] = useState(false);
  const [savingStep1, setSavingStep1] = useState(false);

  const [phrase, setPhrase] = useState("");
  const [phraseConfirm, setPhraseConfirm] = useState("");
  const [savedTick, setSavedTick] = useState(false);
  const [savingStep2, setSavingStep2] = useState(false);

  const country = COUNTRIES.find((c) => c.code === countryCode);

  /* Prefill what the account already has: the username picked at signup (the
     same suggestion the web form makes) and a consent row if the native Google
     path already wrote one. */
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!userId) return;
      const { data } = await supabase
        .from("profiles")
        .select("username,display_name,country_code")
        .eq("id", userId)
        .maybeSingle();
      if (!alive || !data) return;
      const row = data as { username: string | null; display_name: string | null; country_code: string | null };
      const suggested =
        row.username ||
        (row.display_name || "").toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 20) ||
        "";
      if (suggested) setUsername(suggested);
      if (row.country_code) setCountryCode(row.country_code);
      setConsented(await hasCurrentConsent(userId));
      setChecking(false);
    })();
    return () => {
      alive = false;
    };
  }, [userId]);

  const usernameError = useMemo(() => {
    if (!username) return null;
    return validateUsername(username);
  }, [username]);

  const step1Valid = Boolean(
    username &&
    !usernameError &&
    country &&
    phone.trim().length >= 7 &&
    consented
  );

  const phraseValid = phrase.trim().length >= 8;
  const step2Valid = phraseValid && phrase === phraseConfirm && savedTick;

  const saveStep1 = useCallback(async () => {
    if (!userId || !step1Valid || savingStep1) return;
    setSavingStep1(true);
    try {
      /* Uniqueness, the web form's own query — the profiles trigger would also
         reject a duplicate, but a told person beats an errored person. */
      const { data: taken } = await supabase
        .from("profiles")
        .select("id")
        .eq("username", username.trim().toLowerCase())
        .neq("id", userId)
        .maybeSingle();

      if (taken) {
        showToast("That username is taken — try another.", { variant: "error" });
        return;
      }

      const { error } = await supabase
        .from("profiles")
        .update({
          username: username.trim().toLowerCase(),
          country: countryNameFromCode(countryCode),
          country_code: countryCode,
          dial_code: country?.dialCode ?? null,
          phone_number: phone.trim(),
        })
        .eq("id", userId);

      if (error) {
        showToast(error.message.includes("duplicate")
          ? "That username is taken — try another."
          : "Couldn't save your details. Try again.", { variant: "error" });
        return;
      }

      const ok = await grantConsent();
      if (!ok) {
        showToast("Couldn't record your consent. Try again.", { variant: "error" });
        return;
      }

      setStep(2);
    } finally {
      setSavingStep1(false);
    }
  }, [consented, country?.dialCode, countryCode, phone, savingStep1, showToast, step1Valid, userId, username]);

  const saveStep2 = useCallback(async () => {
    if (!session?.access_token || !userId || !step2Valid || savingStep2) return;
    setSavingStep2(true);
    try {
      const res = await fetch(`${apiBase()}/api/set-recovery-phrase`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ phrase: phrase.trim() }),
      });

      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        showToast(json.error || "Couldn't save your recovery phrase. Try again.", { variant: "error" });
        return;
      }

      const { error } = await supabase
        .from("profiles")
        .update({ profile_completed: true })
        .eq("id", userId);

      if (error) {
        showToast("Couldn't finish setup. Try again.", { variant: "error" });
        return;
      }

      showToast("You're all set", { variant: "success" });
      router.replace("/(tabs)/feed");
    } finally {
      setSavingStep2(false);
    }
  }, [phrase, savingStep2, router, session?.access_token, showToast, step2Valid, userId]);

  if (!userId) {
    return (
      <Screen edges={["top", "left", "right"]}>
        <View style={styles.signedOut}>
          <Logo compact />
          <Text style={styles.signedOutText}>Sign in to finish setting up your profile.</Text>
          <GradientButton label="Sign in" onPress={() => router.replace("/(auth)/login")} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen edges={["top", "left", "right"]}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.header}>
            <Logo compact />
            <Text style={styles.title}>
              {step === 1 ? "Finish setting up" : "Save your recovery phrase"}
            </Text>
            <Text style={styles.subtitle}>
              {step === 1
                ? "One username, one country — then your Whisper link works everywhere."
                : "This phrase is the only way to recover your account if you forget your password. Whisper can't reset it for you."}
            </Text>
          </View>

          <View style={styles.stepsRow}>
            {[1, 2].map((n) => (
              <View key={n} style={[styles.stepDot, n <= step && styles.stepDotOn]} />
            ))}
            <Text style={styles.stepLabel}>Step {step} of 2</Text>
          </View>

          {step === 1 ? (
            <View style={styles.card}>
              <Field
                label="Username"
                icon="at-outline"
                value={username}
                onChangeText={(value) => setUsername(value.toLowerCase().replace(/[^a-z0-9_]/g, ""))}
                placeholder={`at least ${USERNAME_MIN} characters`}
                autoCapitalize="none"
                autoComplete="username"
                maxLength={20}
                editable={!checking}
                error={usernameError}
              />

              <Text style={styles.label}>Country</Text>
              <Pressable style={styles.picker} onPress={() => setCountrySheet(true)}>
                <Text style={styles.pickerFlag}>{flagFromCode(countryCode)}</Text>
                <Text style={styles.pickerValue}>{country ? country.name : countryCode}</Text>
                <Ionicons name="chevron-down" size={16} color={COLORS.subtle} />
              </Pressable>

              <Field
                label="Phone number"
                icon="call-outline"
                value={phone}
                onChangeText={(value) => setPhone(value.replace(/[^\d\s+()-]/g, ""))}
                placeholder={country ? `${country.dialCode} ••• ••• ••••` : "Phone number"}
                keyboardType="phone-pad"
              />

              <Pressable
                style={styles.consentRow}
                onPress={() => setConsented((value) => !value)}
              >
                <Toggle value={consented} onChange={setConsented} />
                <Text style={styles.consentText}>
                  I agree to the{" "}
                  <Text
                    style={styles.consentLink}
                    onPress={() => router.push({ pathname: "/legal", params: { slug: "privacy" } })}
                  >
                    Privacy Policy
                  </Text>{" "}
                  and{" "}
                  <Text
                    style={styles.consentLink}
                    onPress={() => router.push({ pathname: "/legal", params: { slug: "terms" } })}
                  >
                    Terms of Service
                  </Text>
                  .
                </Text>
              </Pressable>

              <GradientButton
                label="Continue"
                icon="arrow-forward"
                loading={savingStep1}
                disabled={!step1Valid || checking}
                onPress={() => void saveStep1()}
                style={styles.cta}
              />
            </View>
          ) : (
            <View style={styles.card}>
              <View style={styles.phraseNotice}>
                <Ionicons name="key-outline" size={18} color={COLORS.warning} />
                <Text style={styles.phraseNoticeText}>
                  Write it down and keep it offline. Anyone with this phrase can recover your
                  account — including you, when the password is gone.
                </Text>
              </View>

              <Field
                label="Recovery phrase"
                icon="shield-checkmark-outline"
                value={phrase}
                onChangeText={setPhrase}
                placeholder="8+ characters you won't forget"
                secureTextEntry
                autoComplete="off"
              />
              <Field
                label="Repeat it"
                icon="shield-checkmark-outline"
                value={phraseConfirm}
                onChangeText={setPhraseConfirm}
                placeholder="Same phrase, again"
                secureTextEntry
                autoComplete="off"
                error={phraseConfirm && phrase !== phraseConfirm ? "The phrases don't match." : null}
              />

              <Pressable style={styles.consentRow} onPress={() => setSavedTick((v) => !v)}>
                <Toggle value={savedTick} onChange={setSavedTick} />
                <Text style={styles.consentText}>I&apos;ve saved my phrase somewhere safe.</Text>
              </Pressable>

              <GradientButton
                label="Save and finish"
                icon="checkmark"
                loading={savingStep2}
                disabled={!step2Valid}
                onPress={() => void saveStep2()}
                style={styles.cta}
              />
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>

      <Sheet visible={countrySheet} onClose={() => setCountrySheet(false)} title="Pick your country">
        <ScrollView style={styles.countryList} keyboardShouldPersistTaps="handled">
          {COUNTRIES.map((c) => (
            <Pressable
              key={c.code}
              style={styles.countryRow}
              onPress={() => {
                setCountryCode(c.code);
                setCountrySheet(false);
              }}
            >
              <Text style={styles.countryFlag}>{flagFromCode(c.code)}</Text>
              <Text style={styles.countryName}>{c.name}</Text>
              <Text style={styles.countryDial}>{c.dialCode}</Text>
              {c.code === countryCode ? (
                <Ionicons name="checkmark" size={16} color={COLORS.cyan} />
              ) : null}
            </Pressable>
          ))}
        </ScrollView>
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scroll: { padding: 18, paddingBottom: 48 },

  header: { alignItems: "center", gap: 8, marginTop: 12 },
  title: { color: COLORS.text, fontSize: 22, fontWeight: "900", textAlign: "center" },
  subtitle: {
    color: COLORS.muted,
    fontSize: 13,
    lineHeight: 19,
    textAlign: "center",
    maxWidth: 320,
  },

  stepsRow: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "center", marginTop: 16 },
  stepDot: { width: 26, height: 4, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.12)" },
  stepDotOn: { backgroundColor: COLORS.cyan },
  stepLabel: { color: COLORS.subtle, fontSize: 11, fontWeight: "700", marginLeft: 4 },

  card: {
    marginTop: 18,
    padding: 16,
    gap: 14,
    borderRadius: RADIUS.lg,
    backgroundColor: GLASS.background,
    borderWidth: 1,
    borderColor: GLASS.border,
    ...CARD_SHADOW,
  },

  label: { color: COLORS.muted, fontSize: 12.5, fontWeight: "800", marginBottom: -6 },
  picker: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 13,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: GLASS.border,
    backgroundColor: "rgba(23,18,42,0.55)",
  },
  pickerFlag: { fontSize: 18 },
  pickerValue: { flex: 1, color: COLORS.text, fontSize: 14.5, fontWeight: "700" },

  consentRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 2 },
  consentText: { color: COLORS.muted, fontSize: 12.5, lineHeight: 18, flex: 1 },
  consentLink: { color: COLORS.cyan, fontWeight: "800" },

  phraseNotice: {
    flexDirection: "row",
    gap: 9,
    padding: 11,
    borderRadius: RADIUS.md,
    backgroundColor: "rgba(245,158,11,0.10)",
    borderWidth: 1,
    borderColor: "rgba(245,158,11,0.32)",
  },
  phraseNoticeText: { flex: 1, color: COLORS.warning, fontSize: 12, lineHeight: 17 },

  cta: { marginTop: 6 },

  countryList: { maxHeight: 420 },
  countryRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 11,
    paddingHorizontal: 6,
  },
  countryFlag: { fontSize: 18, width: 30 },
  countryName: { flex: 1, color: COLORS.text, fontSize: 14, fontWeight: "700" },
  countryDial: { color: COLORS.subtle, fontSize: 12.5, fontWeight: "700" },

  signedOut: { flex: 1, alignItems: "center", justifyContent: "center", gap: 14, padding: 28 },
  signedOutText: { color: COLORS.muted, fontSize: 14, textAlign: "center" },
});
