"use client";

/**
 * Avatar — initials circle with a champagne gradient by default.
 * Presentation-only.
 */

import { T } from "./tokens";

export interface AvatarProps {
  /** full name or any string to derive initials from */
  name?: string;
  /** explicit initials override */
  initials?: string;
  size?: number;
  /** alternate background (e.g. a neutral fill); defaults to champagne gradient */
  background?: string;
  /** text color; defaults to champagne ink */
  color?: string;
}

function deriveInitials(name?: string): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2);
  return (parts[0][0] ?? "") + (parts[1][0] ?? "");
}

export default function Avatar({
  name,
  initials,
  size = 26,
  background,
  color,
}: AvatarProps) {
  const text = (initials ?? deriveInitials(name)).toUpperCase();
  return (
    <span
      aria-hidden={!name && !initials}
      style={{
        width: size,
        height: size,
        flexShrink: 0,
        borderRadius: 999,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: Math.round(size * 0.42),
        fontWeight: 700,
        lineHeight: 1,
        letterSpacing: "-0.02em",
        background: background ?? T.champGradient,
        color: color ?? T.champInk,
        userSelect: "none",
      }}
    >
      {text}
    </span>
  );
}
