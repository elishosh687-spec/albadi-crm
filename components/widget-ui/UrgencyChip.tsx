"use client";

/**
 * UrgencyChip — renders a follow-up / urgency state.
 * Presentation-only: the caller passes the already-computed state + label.
 * This component does NOT compute business urgency rules — it only maps
 * a state to a visual style.
 *   overdue → alert red pill
 *   today   → champagne pill
 *   future  → muted plain text
 *   none    → "—"
 */

import { T } from "./tokens";

export type UrgencyState = "overdue" | "today" | "future" | "none";

export interface UrgencyChipProps {
  state: UrgencyState;
  /** display text, e.g. a formatted date or "היום"; ignored for state="none" */
  label?: string;
}

export default function UrgencyChip({ state, label }: UrgencyChipProps) {
  if (state === "none") {
    return <span style={{ color: T.faint }}>—</span>;
  }

  if (state === "future") {
    return (
      <span style={{ color: T.muted, fontVariantNumeric: "tabular-nums" }}>
        {label ?? ""}
      </span>
    );
  }

  const isOverdue = state === "overdue";
  const bg = isOverdue ? "rgba(217,138,138,0.13)" : T.champFill;
  const border = isOverdue ? "rgba(217,138,138,0.32)" : T.champBorder;
  const color = isOverdue ? T.alert : T.champ;

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        height: 20,
        padding: "0 9px",
        fontSize: 11,
        fontWeight: 600,
        lineHeight: 1,
        whiteSpace: "nowrap",
        borderRadius: 999,
        background: bg,
        border: `1px solid ${border}`,
        color,
        fontVariantNumeric: "tabular-nums",
      }}
    >
      {label ?? (isOverdue ? "באיחור" : "היום")}
    </span>
  );
}
