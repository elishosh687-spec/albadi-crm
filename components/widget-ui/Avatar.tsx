"use client";

/**
 * Avatar — initials circle with a champagne gradient by default.
 * Presentation-only.
 */

import { pickAvatarTint } from "./tokens";

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

// Code-point safe: Array.from splits by full code points so astral-plane
// names (emoji / fancy unicode WhatsApp display names) never leave a lone
// surrogate half — which otherwise serialized differently server vs client
// and caused a hydration mismatch.
function deriveInitials(name?: string): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return Array.from(parts[0]).slice(0, 2).join("");
  return (Array.from(parts[0])[0] ?? "") + (Array.from(parts[1])[0] ?? "");
}

export default function Avatar({
  name,
  initials,
  size = 26,
  background,
  color,
}: AvatarProps) {
  const text = (initials ?? deriveInitials(name)).toUpperCase();
  const tint = pickAvatarTint(name || initials || "?");
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
        fontWeight: 600,
        lineHeight: 1,
        letterSpacing: "-0.02em",
        background: background ?? tint.bg,
        color: color ?? tint.ink,
        userSelect: "none",
      }}
    >
      {text}
    </span>
  );
}
