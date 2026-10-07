/**
 * ProofQuest design tokens — the single source of truth for color, spacing,
 * radius, typography and elevation. Screens and UI primitives consume these
 * semantic tokens instead of hardcoding literals, so the look stays consistent
 * and is tunable in one place.
 *
 * Identity: disciplined dark theme. Near-black navy base, calm elevated
 * surfaces, Solana purple as the single primary accent and mint green reserved
 * for success/positive. Glow and tinted-everything are intentionally avoided —
 * hierarchy comes from spacing, weight and restraint.
 */

export const palette = {
  // Base / surfaces (near-black navy, layered by elevation)
  bg: "#07070F",
  surface: "#101024",
  surfaceAlt: "#15152E",
  surfaceHigh: "#1B1B38",
  border: "#232347",
  borderStrong: "#2E2E59",

  // Brand
  purple: "#9B5CFF",
  purpleSoft: "#2A1E52", // low-chroma purple fill for subtle emphasis (no glow)
  mint: "#1FE0A0",
  mintSoft: "#123A32",

  // Semantic accents
  amber: "#F5A623",
  amberSoft: "#3A2E12",
  red: "#FF5C6C",
  redSoft: "#3A1620",

  // Text
  textPrimary: "#F4F4FB",
  textSecondary: "#A6A6C4",
  textMuted: "#6B6B8A",
  textFaint: "#45455F",

  // Fixed
  onAccent: "#07070F", // text/icon on top of a bright accent fill
  white: "#FFFFFF",
  black: "#000000",
} as const;

/** Semantic color roles — prefer these in components over raw palette entries. */
export const color = {
  background: palette.bg,
  surface: palette.surface,
  surfaceAlt: palette.surfaceAlt,
  surfaceHigh: palette.surfaceHigh,
  border: palette.border,
  borderStrong: palette.borderStrong,

  primary: palette.purple,
  primarySoft: palette.purpleSoft,
  success: palette.mint,
  successSoft: palette.mintSoft,
  warning: palette.amber,
  warningSoft: palette.amberSoft,
  danger: palette.red,
  dangerSoft: palette.redSoft,

  textPrimary: palette.textPrimary,
  textSecondary: palette.textSecondary,
  textMuted: palette.textMuted,
  textFaint: palette.textFaint,
  onAccent: palette.onAccent,
  white: palette.white,

  overlay: "rgba(5, 5, 12, 0.72)", // scrim behind modals
} as const;

/** 4-point spacing scale. */
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  huge: 48,
} as const;

/** Corner radii. */
export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  pill: 999,
} as const;

/** Typography scale. RN uses platform font; weights as strings. */
export const typography = {
  display: { fontSize: 32, fontWeight: "800" as const, lineHeight: 38, letterSpacing: -0.5 },
  title: { fontSize: 22, fontWeight: "800" as const, lineHeight: 28, letterSpacing: -0.3 },
  heading: { fontSize: 17, fontWeight: "700" as const, lineHeight: 22 },
  body: { fontSize: 15, fontWeight: "500" as const, lineHeight: 22 },
  bodyStrong: { fontSize: 15, fontWeight: "700" as const, lineHeight: 22 },
  label: { fontSize: 13, fontWeight: "600" as const, lineHeight: 18 },
  caption: { fontSize: 12, fontWeight: "500" as const, lineHeight: 16 },
  overline: { fontSize: 11, fontWeight: "700" as const, lineHeight: 14, letterSpacing: 0.8 },
  mono: { fontSize: 12, fontWeight: "500" as const, lineHeight: 18, fontFamily: "monospace" },
} as const;

/** Subtle elevation (restrained — no colored glow). */
export const elevation = {
  card: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 3,
  },
  modal: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 24,
    elevation: 12,
  },
} as const;

export type QuestStatusKey =
  | "open"
  | "claimed"
  | "submitted"
  | "approved"
  | "cancelled"
  | "refunded";

/**
 * Status presentation: label + color + a non-color cue (dot shape is kept but
 * ALWAYS paired with a text label, so meaning never depends on color alone).
 */
export const statusMeta: Record<
  QuestStatusKey,
  { label: string; fg: string; bg: string }
> = {
  open: { label: "Open", fg: palette.mint, bg: palette.mintSoft },
  claimed: { label: "Claimed", fg: palette.amber, bg: palette.amberSoft },
  submitted: { label: "In review", fg: palette.purple, bg: palette.purpleSoft },
  approved: { label: "Approved", fg: palette.mint, bg: palette.mintSoft },
  cancelled: { label: "Cancelled", fg: palette.textMuted, bg: palette.surfaceAlt },
  refunded: { label: "Refunded", fg: palette.textMuted, bg: palette.surfaceAlt },
};

export const theme = { color, palette, spacing, radius, typography, elevation, statusMeta };
export default theme;
