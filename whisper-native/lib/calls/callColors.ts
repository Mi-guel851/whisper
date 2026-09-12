/**
 * The calls palette.
 *
 * Copied value-for-value from the web app's own call components
 * (`IncomingCallOverlay` / `InCallSheet` / `InCallPill`), which hardcode these
 * in their styles on the web too: the near-black green-tinted "island" the
 * ring and the live call both sit on, the WhatsApp-green accept control, the
 * theme's red decline, and the green glow family that pulses around the
 * avatar. One module here so the native port holds exactly one copy, the way
 * the web holds one copy per component.
 */
export const CALL_COLORS = {
  /** The full-screen ring / in-call surface. */
  island: "#07130f",
  /** The minimized pill's raised surface. */
  islandRaised: "#0d211a",
  /** The accept control — the green every phone reads as "answer". */
  accept: "#25D366",
  /** The decline / end control — the theme's `--theme-error`. */
  decline: "#ef4444",
  /** Icons on the green control. */
  onAccept: "#07130f",

  /** The green wash behind the avatar. */
  glow: "rgba(37,211,102,0.16)",
  /** The cyan counter-glow, low right. */
  glowCyan: "rgba(34,211,238,0.08)",
  /** Expanding pulse-ring stroke. */
  ring: "rgba(37,211,102,0.45)",
  /** The avatar's standing ring. */
  avatarRing: "rgba(37,211,102,0.62)",
  /** The avatar ring while identity is still resolving. */
  avatarRingFaint: "rgba(37,211,102,0.22)",
} as const;
