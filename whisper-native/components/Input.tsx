import { Ionicons } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import { useState } from "react";
import {
  StyleSheet,
  Text,
  TextInput,
  View,
  type KeyboardTypeOptions,
  type StyleProp,
  type ViewStyle,
} from "react-native";

import { COLORS, GLASS, RADIUS, useStyles } from "@/lib/theme";

/**
 * Inputs.
 *
 * Dark glass, with a cyan border while focused — the brief's rule, and the one
 * place the accent appears outside a button. The border is the *only* focus
 * affordance, so it is applied to the outer frame rather than to the text field:
 * a border drawn on the field itself would shift the text by a pixel when it
 * appears.
 */

export function Field({
  label,
  icon,
  value,
  onChangeText,
  placeholder,
  secureTextEntry = false,
  keyboardType,
  autoCapitalize = "none",
  autoComplete,
  multiline = false,
  maxLength,
  editable = true,
  error,
  style,
  onSubmitEditing,
  returnKeyType,
  blurOnSubmit,
}: {
  label?: string;
  icon?: keyof typeof Ionicons.glyphMap;
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  secureTextEntry?: boolean;
  keyboardType?: KeyboardTypeOptions;
  autoCapitalize?: "none" | "sentences" | "words" | "characters";
  autoComplete?: "email" | "password" | "username" | "name" | "off";
  multiline?: boolean;
  maxLength?: number;
  editable?: boolean;
  error?: string | null;
  style?: StyleProp<ViewStyle>;
  onSubmitEditing?: () => void;
  returnKeyType?: "done" | "next" | "go" | "send" | "search";
  blurOnSubmit?: boolean;
}) {
  const styles = useStyles(makeStyles);
  const [focused, setFocused] = useState(false);

  return (
    <View style={style}>
      {label && <Text style={styles.label}>{label}</Text>}

      <BlurView
        intensity={GLASS.blurIntensity}
        tint={GLASS.tint}
        style={[
          styles.frame,
          multiline && styles.frameMultiline,
          {
            borderColor: error ? COLORS.danger : focused ? COLORS.cyan : GLASS.border,
            backgroundColor: focused ? "rgba(34,211,238,0.06)" : "rgba(23,18,42,0.55)",
          },
        ]}
      >
        <View style={styles.inner}>
          {icon && (
            <Ionicons
              name={icon}
              size={18}
              color={focused ? COLORS.cyan : COLORS.subtle}
              style={multiline ? styles.iconMultiline : undefined}
            />
          )}

          <TextInput
            value={value}
            onChangeText={onChangeText}
            placeholder={placeholder}
            placeholderTextColor={COLORS.subtle}
            secureTextEntry={secureTextEntry}
            keyboardType={keyboardType}
            autoCapitalize={autoCapitalize}
            autoComplete={autoComplete}
            autoCorrect={false}
            multiline={multiline}
            maxLength={maxLength}
            editable={editable}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onSubmitEditing={onSubmitEditing}
            returnKeyType={returnKeyType}
            blurOnSubmit={blurOnSubmit}
            /* The app is dark everywhere; without this the iOS keyboard's
               suggestion bar renders in light mode over a dark screen. */
            keyboardAppearance={GLASS.tint === "light" ? "light" : "dark"}
            style={[styles.input, multiline && styles.inputMultiline]}
          />
        </View>
      </BlurView>

      {error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
}

/**
 * The search field: a single-line pill with a leading magnifier and a clear
 * button. Used by the feed and the inbox, which is why it carries its own
 * padding rather than delegating to `Field`.
 */
export function SearchField({
  value,
  onChangeText,
  placeholder = "Search",
  style,
}: {
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const styles = useStyles(makeStyles);
  const [focused, setFocused] = useState(false);

  return (
    <BlurView
      intensity={GLASS.blurIntensity}
      tint={GLASS.tint}
      style={[styles.searchFrame, { borderColor: focused ? COLORS.cyan : GLASS.border }, style]}
    >
      <Ionicons name="search" size={16} color={COLORS.subtle} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={COLORS.subtle}
        autoCorrect={false}
        autoCapitalize="none"
        returnKeyType="search"
        keyboardAppearance={GLASS.tint === "light" ? "light" : "dark"}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={styles.searchInput}
      />
    </BlurView>
  );
}

const makeStyles = () => StyleSheet.create({
  label: {
    color: COLORS.muted,
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: 7,
    marginLeft: 4,
  },
  frame: {
    borderRadius: RADIUS.md,
    borderWidth: 1,
    overflow: "hidden",
  },
  frameMultiline: { borderRadius: RADIUS.lg },
  inner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    minHeight: 52,
  },
  iconMultiline: { alignSelf: "flex-start", marginTop: 16 },
  input: {
    flex: 1,
    color: COLORS.text,
    fontSize: 16,
    paddingVertical: 14,
  },
  inputMultiline: {
    minHeight: 110,
    textAlignVertical: "top",
    paddingTop: 14,
  },
  error: { color: COLORS.danger, fontSize: 13, marginTop: 6, marginLeft: 4 },
  searchFrame: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: RADIUS.pill,
    borderWidth: 1,
    paddingHorizontal: 14,
    height: 42,
    overflow: "hidden",
  },
  searchInput: { flex: 1, color: COLORS.text, fontSize: 15, paddingVertical: 0 },
});
