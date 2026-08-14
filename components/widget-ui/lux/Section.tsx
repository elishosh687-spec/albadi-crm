/**
 * Section — a numbered warm card with a giant faint serif numeral (I/II/III/IV)
 * in the corner, matching the calculator's editorial sections. Presentation-only.
 */

import type { CSSProperties, ReactNode } from "react";

export interface SectionProps {
  /** roman/any numeral rendered huge + faint behind the corner */
  numeral?: string;
  /** small uppercase eyebrow (optional) */
  eyebrow?: string;
  /** section title (right-aligned in RTL) */
  title?: ReactNode;
  children?: ReactNode;
  style?: CSSProperties;
}

export default function Section({
  numeral,
  eyebrow,
  title,
  children,
  style,
}: SectionProps) {
  return (
    <div
      style={{
        position: "relative",
        overflow: "hidden",
        background: "var(--lux-card)",
        borderRadius: 8,
        boxShadow: "inset 0 0 0 1px var(--lux-line)",
        // fluid: identical 18/20px at >=500px, tighter on a phone
        padding: "clamp(14px, 4vw, 18px) clamp(12px, 4vw, 20px)",
        ...style,
      }}
    >
      {numeral ? (
        <span
          className="lux-numeral"
          aria-hidden
          style={{
            position: "absolute",
            insetInlineStart: 14,
            top: -6,
            fontSize: 84,
          }}
        >
          {numeral}
        </span>
      ) : null}
      {(eyebrow || title) && (
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            gap: 12,
            // same reasoning as LuxTitle — a no-op when the row fits
            flexWrap: "wrap",
            rowGap: 8,
            marginBottom: 14,
            position: "relative",
          }}
        >
          {title ? (
            <div style={{ fontSize: 16, color: "var(--lux-ink)", fontWeight: 500 }}>
              {title}
            </div>
          ) : <span />}
          {eyebrow ? <span className="lux-label">{eyebrow}</span> : null}
        </div>
      )}
      <div style={{ position: "relative" }}>{children}</div>
    </div>
  );
}
