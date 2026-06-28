/**
 * Shared design tokens for the graphite-glass widget primitives.
 * Presentation-only, client-safe. No env access, no server imports.
 * Values mirror the locked redesign palette (see app/globals.css --gg-*).
 */

export const T = {
  bg: "#050506",
  glassBg: "rgba(255,255,255,0.045)",
  glassBorder: "rgba(255,255,255,0.11)",
  hairline: "rgba(255,255,255,0.07)",

  text: "#f5f6f7",
  muted: "#8f939b",
  faint: "#6b7079",

  champ: "#e7cba6",
  champStrong: "#fdf3e6",
  champFill: "rgba(205,169,120,0.16)",
  champBorder: "rgba(205,169,120,0.34)",
  champGradient: "linear-gradient(135deg,#e7cba6,#cda978)",
  champInk: "#1b1407",

  success: "#7dd3a8",
  warn: "#cbb079",
  alert: "#d98a8a",

  rowHover: "rgba(255,255,255,0.025)",
} as const;

export type Tone = "success" | "warn" | "alert" | "champagne" | "neutral";

/** tint pill colors per tone — low-sat fill + border + text */
export function toneStyle(tone: Tone): {
  bg: string;
  border: string;
  color: string;
} {
  switch (tone) {
    case "success":
      return {
        bg: "rgba(125,211,168,0.12)",
        border: "rgba(125,211,168,0.30)",
        color: T.success,
      };
    case "warn":
      return {
        bg: "rgba(203,176,121,0.12)",
        border: "rgba(203,176,121,0.30)",
        color: T.warn,
      };
    case "alert":
      return {
        bg: "rgba(217,138,138,0.13)",
        border: "rgba(217,138,138,0.32)",
        color: T.alert,
      };
    case "champagne":
      return {
        bg: T.champFill,
        border: T.champBorder,
        color: T.champ,
      };
    case "neutral":
    default:
      return {
        bg: "rgba(255,255,255,0.05)",
        border: "rgba(255,255,255,0.10)",
        color: T.muted,
      };
  }
}
