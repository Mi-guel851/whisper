import { Ionicons } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { vibrate } from "./haptics";
import { COLORS, GLASS, RADIUS } from "./theme";

/**
 * Toasts.
 *
 * The app has exactly one channel for "something happened that you didn't ask
 * for", and this is it. Every write in the product — a failed send, an unlocked
 * hint, a copied link, a payment that is still settling — reports through here,
 * which is why the wording is short and the tone is carried by a colour rather
 * than a paragraph.
 *
 * Four variants, and the difference between them is honestly small: an icon, an
 * accent, and the haptic. `subtle` is the one that matters — it is for things
 * the user caused and already knows about (a link copied, a hint unlocked), and
 * it deliberately does *not* buzz, because a confirmation of your own action is
 * not news.
 *
 * Only one toast is on screen at a time. A queue that stacks is a queue that
 * covers the composer, and the second message is never more important than the
 * thing the user was doing.
 */

export type ToastVariant = "info" | "success" | "error" | "warning" | "subtle";

type Toast = {
  id: number;
  message: string;
  variant: ToastVariant;
  duration: number;
};

type ToastContextValue = {
  showToast: (message: string, options?: { variant?: ToastVariant; duration?: number }) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

const VISUALS: Record<ToastVariant, { icon: keyof typeof Ionicons.glyphMap; accent: string }> = {
  info: { icon: "information-circle-outline", accent: COLORS.cyan },
  success: { icon: "checkmark-circle-outline", accent: COLORS.success },
  error: { icon: "alert-circle-outline", accent: COLORS.danger },
  warning: { icon: "warning-outline", accent: COLORS.warning },
  subtle: { icon: "ellipse-outline", accent: COLORS.muted },
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<Toast | null>(null);
  const counter = useRef(0);

  const showToast = useCallback<ToastContextValue["showToast"]>((message, options) => {
    const variant = options?.variant ?? "info";

    counter.current += 1;
    setToast({
      id: counter.current,
      message,
      variant,
      duration: options?.duration ?? (variant === "error" ? 4200 : 2600),
    });

    /* The buzz is part of the message. An error you did not look at still has
       to reach you; a link copied does not. */
    if (variant === "error" || variant === "warning") vibrate("warning");
    else if (variant === "success") vibrate("success");
  }, []);

  const value = useMemo(() => ({ showToast }), [showToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {toast && <ToastView key={toast.id} toast={toast} onDone={() => setToast(null)} />}
    </ToastContext.Provider>
  );
}

function ToastView({ toast, onDone }: { toast: Toast; onDone: () => void }) {
  const insets = useSafeAreaInsets();
  const progress = useSharedValue(0);

  const dismiss = useCallback(() => {
    progress.value = withTiming(0, { duration: 180, easing: Easing.in(Easing.cubic) }, (finished) => {
      if (finished) runOnJS(onDone)();
    });
  }, [onDone, progress]);

  React.useEffect(() => {
    progress.value = withTiming(1, { duration: 240, easing: Easing.out(Easing.cubic) });

    /* The dismissal is a JS timer rather than a `withDelay` on the same shared
       value: two assignments to one value cancel each other, so chaining them
       would drop the entrance animation entirely. The timer is cleared on
       unmount, which is why a toast that is replaced mid-flight still leaves a
       working tree behind it. */
    const timer = setTimeout(() => dismiss(), toast.duration);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toast.id]);

  const style = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: (1 - progress.value) * 24 }, { scale: 0.96 + progress.value * 0.04 }],
  }));

  const visual = VISUALS[toast.variant];

  return (
    <View pointerEvents="none" style={[styles.wrap, { bottom: Math.max(insets.bottom, 16) + 84 }]}>
      <Animated.View style={style}>
        <BlurView intensity={GLASS.blurIntensity} tint="dark" style={[styles.toast, { borderColor: `${visual.accent}55` }]}>
          <View style={[styles.iconWrap, { backgroundColor: `${visual.accent}22` }]}>
            <Ionicons name={visual.icon} size={16} color={visual.accent} />
          </View>
          <Text style={styles.message} numberOfLines={3}>
            {toast.message}
          </Text>
        </BlurView>
      </Animated.View>
    </View>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast must be used inside <ToastProvider>");
  return context;
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    left: 16,
    right: 16,
    alignItems: "center",
  },
  toast: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    backgroundColor: "rgba(18,14,32,0.86)",
    paddingHorizontal: 14,
    paddingVertical: 12,
    overflow: "hidden",
    maxWidth: 460,
  },
  iconWrap: { width: 28, height: 28, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  message: { color: COLORS.text, fontSize: 13.5, fontWeight: "600", flexShrink: 1, lineHeight: 19 },
});
