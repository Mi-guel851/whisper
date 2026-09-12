import { Ionicons } from "@expo/vector-icons";

import { GhostMark } from "./Logo";
import { COLORS } from "@/lib/theme";

/**
 * The icon for one bottom-tab destination.
 *
 * Pulled out of the tab bar so the same mark can be used by the drawer, the
 * profile's shortcuts and the onboarding copy without four copies of the rule
 * "the alerts tab shows the ghost when it is not selected".
 */
export function TabIcon({
  name,
  focused,
}: {
  name: "Feed" | "DMs" | "Notifications" | "Profile";
  focused: boolean;
}) {
  if (name === "Notifications" && !focused) {
    return <GhostMark size={22} />;
  }

  const glyph: Record<typeof name, { on: keyof typeof Ionicons.glyphMap; off: keyof typeof Ionicons.glyphMap }> = {
    Feed: { on: "home", off: "home-outline" },
    DMs: { on: "chatbubbles", off: "chatbubbles-outline" },
    Notifications: { on: "notifications", off: "notifications-outline" },
    Profile: { on: "person", off: "person-outline" },
  };

  const { on, off } = glyph[name];

  return (
    <Ionicons
      name={focused ? on : off}
      size={22}
      color={focused ? COLORS.contrast : COLORS.muted}
    />
  );
}
