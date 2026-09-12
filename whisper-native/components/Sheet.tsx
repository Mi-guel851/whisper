import { Ionicons } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import React, { useEffect } from "react";
import { Dimensions, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { COLORS, GLASS, RADIUS, SPRINGS, useStyles } from "@/lib/theme";

/**
 * The bottom sheet.
 *
 * Every modal in this app is one of these: a dimmed, blurred backdrop and a
 * glass panel sliding up from the bottom edge. The brief asks for slide-up on
 * modals, and it is also the right native gesture — the sheet arrives under the
 * thumb that opened it.
 *
 * `Modal` is React Native's, not a JS-rendered overlay, so the sheet is above
 * everything including the tab bar and the keyboard handling behaves. The
 * animation runs in reanimated on the UI thread; `runOnJS` is only used to
 * unmount after the exit animation, so a dismissed sheet never lingers invisible
 * on top of a tappable screen.
 */
export function Sheet({
  visible,
  onClose,
  title,
  children,
  /** A sheet that is too tall to dismiss by tapping outside should say so. */
  dismissable = true,
}: {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  dismissable?: boolean;
}) {
  const styles = useStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const progress = useSharedValue(0);
  const [mounted, setMounted] = React.useState(visible);
  const height = Dimensions.get("window").height;

  useEffect(() => {
    if (visible) {
      setMounted(true);
      /* The web's `sheetUp` enters on the base-soft spring (320/32/.9) from
         y:100% — the same physics here; Reanimated's mass/damping map one to
         one. The backdrop keeps a timing fade (the web's `backdrop` variant). */
      progress.value = withSpring(1, SPRINGS.smooth);
      return;
    }

    /* The exit is the web's y:100% leave on `--ease-soft`: a timed slide, not
       a spring — a spring on the way out overshoots past the screen edge. */
    progress.value = withTiming(0, { duration: 260, easing: Easing.bezier(0.65, 0, 0.35, 1) }, (finished) => {
      if (finished) runOnJS(setMounted)(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const backdropStyle = useAnimatedStyle(() => ({ opacity: progress.value }));
  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: (1 - progress.value) * Math.min(420, height * 0.5) }],
    opacity: progress.value,
  }));

  if (!mounted) return null;

  return (
    <Modal transparent visible animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.root}>
        <Animated.View style={[styles.backdrop, backdropStyle]}>
          <BlurView intensity={24} tint="dark" style={StyleSheet.absoluteFill} />
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={dismissable ? onClose : undefined}
            accessibilityLabel="Close"
          />
        </Animated.View>

        <Animated.View style={[styles.sheetWrap, sheetStyle, { paddingBottom: Math.max(insets.bottom, 14) }]}>
          <Pressable style={styles.grabberWrap} onPress={dismissable ? onClose : undefined}>
            <View style={styles.grabber} />
          </Pressable>

          {title && (
            <View style={styles.header}>
              <Text style={styles.title}>{title}</Text>
              {dismissable && (
                <Pressable onPress={onClose} hitSlop={10} accessibilityLabel="Close">
                  <Ionicons name="close" size={20} color={COLORS.muted} />
                </Pressable>
              )}
            </View>
          )}

          {children}
        </Animated.View>
      </View>
    </Modal>
  );
}

/**
 * A confirmation dialog — the same sheet with a smaller footprint, used for
 * destructive actions (delete a whisper, log out). The web app has a
 * `ConfirmDialog` for exactly these and it is always two buttons and a sentence.
 */
export function ConfirmSheet({
  visible,
  title,
  message,
  confirmLabel = "Confirm",
  destructive = false,
  busy = false,
  onConfirm,
  onCancel,
}: {
  visible: boolean;
  title: string;
  message?: string;
  confirmLabel?: string;
  destructive?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const styles = useStyles(makeStyles);
  return (
    <Sheet visible={visible} onClose={onCancel} title={title}>
      {message ? <Text style={styles.message}>{message}</Text> : null}

      <View style={styles.actions}>
        <Pressable style={[styles.action, styles.actionGhost]} onPress={onCancel} disabled={busy}>
          <Text style={styles.actionGhostText}>Cancel</Text>
        </Pressable>

        <Pressable
          style={[
            styles.action,
            { backgroundColor: destructive ? "rgba(239,68,68,0.18)" : "rgba(34,211,238,0.16)" },
          ]}
          onPress={onConfirm}
          disabled={busy}
        >
          <Text style={[styles.actionText, { color: destructive ? COLORS.danger : COLORS.cyan }]}>
            {busy ? "Working…" : confirmLabel}
          </Text>
        </Pressable>
      </View>
    </Sheet>
  );
}

/** A tappable row inside a sheet — the shape every menu in the app uses. */
export function SheetRow({
  icon,
  label,
  detail,
  onPress,
  danger = false,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  detail?: string;
  onPress: () => void;
  danger?: boolean;
}) {
  const styles = useStyles(makeStyles);
  return (
    <Pressable style={styles.row} onPress={onPress} accessibilityRole="button">
      <View style={[styles.rowIcon, danger && { backgroundColor: "rgba(239,68,68,0.14)" }]}>
        <Ionicons name={icon} size={17} color={danger ? COLORS.danger : COLORS.purple} />
      </View>
      <View style={styles.rowText}>
        <Text style={[styles.rowLabel, danger && { color: COLORS.danger }]}>{label}</Text>
        {detail ? <Text style={styles.rowDetail}>{detail}</Text> : null}
      </View>
      <Ionicons name="chevron-forward" size={16} color={COLORS.subtle} />
    </Pressable>
  );
}

const makeStyles = () => StyleSheet.create({
  root: { flex: 1, justifyContent: "flex-end" },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(4,2,10,0.66)" },
  sheetWrap: {
    borderTopLeftRadius: RADIUS.xxl,
    borderTopRightRadius: RADIUS.xxl,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: GLASS.border,
    backgroundColor: "rgba(12,9,24,0.96)",
    paddingHorizontal: 18,
    paddingTop: 8,
    maxHeight: "86%",
  },
  grabberWrap: { alignItems: "center", paddingVertical: 8 },
  grabber: { width: 42, height: 4, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.22)" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingBottom: 12,
  },
  title: { color: COLORS.text, fontSize: 17, fontWeight: "800" },
  message: { color: COLORS.muted, fontSize: 14, lineHeight: 20, paddingBottom: 18 },
  actions: { flexDirection: "row", gap: 10 },
  action: {
    flex: 1,
    height: 48,
    borderRadius: RADIUS.md,
    alignItems: "center",
    justifyContent: "center",
  },
  actionGhost: { backgroundColor: "rgba(255,255,255,0.06)" },
  actionGhostText: { color: COLORS.text, fontSize: 15, fontWeight: "700" },
  actionText: { fontSize: 15, fontWeight: "800" },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12 },
  rowIcon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: "rgba(168,85,247,0.14)",
    alignItems: "center",
    justifyContent: "center",
  },
  rowText: { flex: 1 },
  rowLabel: { color: COLORS.text, fontSize: 15, fontWeight: "600" },
  rowDetail: { color: COLORS.subtle, fontSize: 12, marginTop: 1 },
});
