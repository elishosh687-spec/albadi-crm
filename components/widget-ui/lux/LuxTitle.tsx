/**
 * LuxTitle — the editorial page header repeated on every Silent-Luxury tab:
 * an ALL-CAPS Manrope overline, a thin Heebo title with an italic-serif accent
 * word, and a muted subtitle. Presentation-only.
 *
 * Usage:
 *   <LuxTitle overline="— Factory quotes" subtitle="חפש לקוח…">
 *     הצעות <LuxAccent>מהמפעל</LuxAccent>.
 *   </LuxTitle>
 */

import type { CSSProperties, ReactNode } from "react";

export function LuxAccent({ children }: { children: ReactNode }) {
  return <span className="lux-accent">{children}</span>;
}

export interface LuxTitleProps {
  /** small uppercase Latin overline (optional) */
  overline?: string;
  /** the title line — pass plain text + <LuxAccent> for the accent word */
  children: ReactNode;
  /** muted one-line description under the title (optional) */
  subtitle?: ReactNode;
  /** right-side slot (counts / actions) aligned to the title baseline */
  aside?: ReactNode;
  style?: CSSProperties;
}

export default function LuxTitle({
  overline,
  children,
  subtitle,
  aside,
  style,
}: LuxTitleProps) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "space-between",
        gap: 16,
        marginBottom: 18,
        ...style,
      }}
    >
      <div>
        {overline ? (
          <div className="lux-overline" style={{ marginBottom: 8 }}>
            {overline}
          </div>
        ) : null}
        <div className="lux-title">{children}</div>
        {subtitle ? (
          <div style={{ fontSize: 13, color: "var(--lux-muted)", marginTop: 6 }}>
            {subtitle}
          </div>
        ) : null}
      </div>
      {aside ? <div style={{ flexShrink: 0 }}>{aside}</div> : null}
    </div>
  );
}
