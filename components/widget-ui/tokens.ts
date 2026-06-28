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

export type Tone =
  | "success"
  | "warn"
  | "alert"
  | "champagne"
  | "info"
  | "engaged"
  | "neutral";

/**
 * Low-sat avatar tints — champagne is just ONE of several so identity circles
 * stay scannable (Attio-style) instead of a wall of gold. Champagne the ACCENT
 * is reserved for money; champagne the avatar tint is incidental.
 */
export const AVATAR_TINTS = [
  { bg: "linear-gradient(135deg,#e7cba6,#cda978)", ink: "#1b1407" },
  { bg: "linear-gradient(135deg,#9fb6c9,#6f8a9f)", ink: "#0e1822" },
  { bg: "linear-gradient(135deg,#a0c9b3,#6f9f86)", ink: "#0e1d15" },
  { bg: "linear-gradient(135deg,#c9a0be,#9f6f93)", ink: "#1d0e1a" },
  { bg: "linear-gradient(135deg,#b6b2a9,#86837c)", ink: "#1a1813" },
] as const;

/** Deterministic tint pick (same key → same color, identical server/client). */
export function pickAvatarTint(key: string): { bg: string; ink: string } {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return AVATAR_TINTS[h % AVATAR_TINTS.length];
}

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
    case "info":
      return {
        bg: "rgba(159,182,201,0.12)",
        border: "rgba(159,182,201,0.30)",
        color: "#b9c6d4",
      };
    case "engaged":
      return {
        bg: "rgba(125,200,205,0.12)",
        border: "rgba(125,200,205,0.30)",
        color: "#8fcdd3",
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
