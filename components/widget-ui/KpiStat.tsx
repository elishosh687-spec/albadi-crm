"use client";

/**
 * KpiStat — big numeral + small muted caption. No card wrapper.
 * Presentation-only.
 */

import { T, type Tone } from "./tokens";

export interface KpiStatProps {
  value: React.ReactNode;
  caption: string;
  /** number tone — "champagne" for money, "alert" for urgent */
  tone?: Tone;
  align?: "start" | "center" | "end";
}

function numberColor(tone?: Tone): string {
  switch (tone) {
    case "champagne":
      return T.champStrong;
    case "alert":
      return T.alert;
    case "success":
      return T.success;
    case "warn":
      return T.warn;
    default:
      return T.text;
  }
}

export default function KpiStat({
  value,
  caption,
  tone = "neutral",
  align = "start",
}: KpiStatProps) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 2,
        alignItems:
          align === "center" ? "center" : align === "end" ? "flex-end" : "flex-start",
      }}
    >
      <span
        style={{
          fontSize: 23,
          fontWeight: 500,
          lineHeight: 1.1,
          color: numberColor(tone),
          fontVariantNumeric: "tabular-nums",
          letterSpacing: "-0.02em",
        }}
      >
        {value}
      </span>
      <span style={{ fontSize: 11, color: T.muted, lineHeight: 1.2 }}>{caption}</span>
    </div>
  );
}
