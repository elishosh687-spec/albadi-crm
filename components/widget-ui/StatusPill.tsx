"use client";

/**
 * StatusPill — low-saturation tint pill for stage / status labels.
 * Presentation-only. Caller passes label + tone.
 */

import { toneStyle, type Tone } from "./tokens";

export interface StatusPillProps {
  label: string;
  tone?: Tone;
}

export default function StatusPill({ label, tone = "neutral" }: StatusPillProps) {
  const s = toneStyle(tone);
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        height: 20,
        padding: "0 9px",
        fontSize: 11,
        fontWeight: 600,
        lineHeight: 1,
        whiteSpace: "nowrap",
        borderRadius: 999,
        background: s.bg,
        border: `1px solid ${s.border}`,
        color: s.color,
      }}
    >
      {label}
    </span>
  );
}
