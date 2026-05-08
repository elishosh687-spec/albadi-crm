/**
 * Design tokens — Paper & Ink palette.
 * Editorial Hebrew minimalism. Single source of truth for all inline styles.
 */

export const colors = {
  paper: "#faf8f4",
  surface: "#ffffff",
  surfaceMuted: "#f3efe6",
  ink: "#1c1815",
  inkMuted: "#736b62",
  inkSubtle: "#a8a29a",
  rule: "#e8e2d8",
  ruleSoft: "#f0ebe1",

  accent: "#9c4221",
  accentHover: "#7c3517",
  accentSoft: "#f9ede7",

  success: "#3f6d3a",
  successBg: "#eef2e7",
  warning: "#a86b1a",
  warningBg: "#fbf3e3",
  danger: "#a92e1f",
  dangerBg: "#f9e9e6",
  info: "#3a5d7c",
  infoBg: "#eaf0f5",
} as const;

export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  "2xl": 32,
  "3xl": 48,
  "4xl": 80,
} as const;

export const radius = {
  sm: 4,
  md: 6,
  lg: 8,
  xl: 12,
  full: 9999,
} as const;

export const shadow = {
  none: "none",
  hairline: `0 0 0 1px ${colors.rule}`,
  card: `0 1px 0 ${colors.rule}`,
  raised:
    "0 1px 2px rgba(28,24,21,.04), 0 4px 12px rgba(28,24,21,.04)",
} as const;

export const size = {
  xs: 12,
  sm: 13,
  md: 14,
  base: 16,
  lg: 18,
  xl: 22,
  "2xl": 28,
  "3xl": 40,
  "4xl": 56,
} as const;

export const weight = {
  regular: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
} as const;

export const leading = {
  tight: 1.15,
  normal: 1.5,
  loose: 1.7,
} as const;

export const fontStack = {
  display: "var(--font-display), 'Frank Ruhl Libre', 'David', Georgia, serif",
  body: "var(--font-body), 'Heebo', 'Assistant', system-ui, -apple-system, sans-serif",
} as const;

export const tabularNums: React.CSSProperties = {
  fontVariantNumeric: "tabular-nums",
};

export const eyebrowStyle: React.CSSProperties = {
  fontFamily: fontStack.body,
  fontSize: size.xs,
  fontWeight: weight.medium,
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  color: colors.inkMuted,
  margin: 0,
};

export const headingStyle = (level: "h1" | "h2" | "h3" = "h2"): React.CSSProperties => {
  const sizes = {
    h1: size["3xl"],
    h2: size.xl,
    h3: size.lg,
  };
  return {
    fontFamily: fontStack.display,
    fontSize: sizes[level],
    fontWeight: weight.medium,
    letterSpacing: "-0.01em",
    color: colors.ink,
    lineHeight: leading.tight,
    margin: 0,
  };
};
