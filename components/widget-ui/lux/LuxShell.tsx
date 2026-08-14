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
  /**
   * page padding. Left undefined the shell uses the `.lux-shell` class, whose
   * padding is 26px 32px 40px on desktop and tightens on a phone — an inline
   * default would beat the media query and cost every screen 64px of width.
   */
  padding?: string;
}

export default function LuxShell({
  children,
  className = "",
  style,
  padding,
}: LuxShellProps) {
  return (
    <div
      className={`lux-theme hubscroll lux-shell ${className}`}
      dir="rtl"
      style={{
        // dvh, not vh: mobile Safari's collapsing toolbar makes 100vh taller
        // than the visible viewport, which clips the bottom of every screen.
        minHeight: "100dvh",
        overflowY: "auto",
        ...(padding ? { padding } : null),
        ...style,
      }}
    >
      {children}
    </div>
  );
}
