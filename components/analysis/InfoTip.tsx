"use client";

import { useState } from "react";

/**
 * A small ℹ️ affordance next to a title. Clicking toggles a short Hebrew
 * explanation rendered as a full-width line in normal flow (NOT an absolutely
 * positioned popover) so it never gets clipped inside cards with
 * overflow:hidden. Hidden by default — the user opted for "icon next to each
 * title" over always-visible help text.
 */

// Just the clickable dot — caller decides where to render the help line.
export function InfoDot({
  open,
  onToggle,
  size = 13,
}: {
  open: boolean;
  onToggle: () => void;
  size?: number;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      aria-label="מה זה עושה"
      title="מה זה עושה"
      style={{
        flexShrink: 0,
        width: size + 5,
        height: size + 5,
        borderRadius: 99,
        border: 0,
        cursor: "pointer",
        fontFamily: "inherit",
        fontSize: size - 2,
        lineHeight: 1,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        color: open ? "var(--lux-champagne, #d6c4ac)" : "var(--lux-muted, #8a7f74)",
        background: open ? "rgba(214,196,172,0.16)" : "rgba(255,255,255,0.04)",
        boxShadow: `inset 0 0 0 1px ${
          open ? "rgba(214,196,172,0.40)" : "rgba(105,106,109,0.28)"
        }`,
      }}
    >
      i
    </button>
  );
}

export const infoLineStyle: React.CSSProperties = {
  fontSize: 11.5,
  lineHeight: 1.55,
  color: "var(--lux-muted, #a8a29a)",
  background: "rgba(214,196,172,0.06)",
  boxShadow: "inset 0 0 0 1px rgba(214,196,172,0.18)",
  borderRadius: 6,
  padding: "8px 11px",
  marginTop: 8,
};

/**
 * Self-contained: renders `children` (the title) inline with an ℹ️ dot, and,
 * when open, the help line directly beneath. Use for standalone titles.
 */
export default function InfoTip({
  info,
  children,
  gap = 8,
  align = "center",
}: {
  info: React.ReactNode;
  children: React.ReactNode;
  gap?: number;
  align?: React.CSSProperties["alignItems"];
}) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: align, gap, minWidth: 0 }}>
        {children}
        <InfoDot open={open} onToggle={() => setOpen((o) => !o)} />
      </div>
      {open && <div style={infoLineStyle}>{info}</div>}
    </div>
  );
}
