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
        // clip, NOT auto: with min-height the shell grows with its content, so
        // `overflow: auto` never scrolled — the window does — but it still made
        // the shell the scroll container of every `position: sticky` child,
        // which then never stuck (calculator summary, shipping rail). `clip`
        // keeps wide content from scrolling the page sideways without that.
        overflowX: "clip",
        ...(padding ? { padding } : null),
        ...style,
      }}
    >
      {children}
    </div>
  );
}
