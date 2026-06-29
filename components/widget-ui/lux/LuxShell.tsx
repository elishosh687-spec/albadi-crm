/**
 * LuxShell — the warm-dark "Silent Luxury" page shell for a hub tab.
 * Presentation-only. Applies the `.lux-theme` token scope so every child
 * (utility classes + widget-ui primitives) re-skins to the warm palette, and
 * provides the mockup's scroll container + page padding.
 */

import type { CSSProperties, ReactNode } from "react";

export interface LuxShellProps {
  children: ReactNode;
  /** extra classes appended to the shell */
  className?: string;
  style?: CSSProperties;
  /** page padding (mockup default: 26px 32px 40px) */
  padding?: string;
}

export default function LuxShell({
  children,
  className = "",
  style,
  padding = "26px 32px 40px",
}: LuxShellProps) {
  return (
    <div
      className={`lux-theme hubscroll ${className}`}
      dir="rtl"
      style={{
        minHeight: "100vh",
        overflowY: "auto",
        padding,
        ...style,
      }}
    >
      {children}
    </div>
  );
}
