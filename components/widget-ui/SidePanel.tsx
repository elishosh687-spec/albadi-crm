"use client";

/**
 * SidePanel — a logical-end (RTL: left) slide-in drawer. Designed to live
 * inside a `position: relative` parent (absolute, not fixed). Presentation-only.
 */

import { X } from "lucide-react";
import { T } from "./tokens";

export interface SidePanelProps {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  width?: number;
  children?: React.ReactNode;
}

export default function SidePanel({
  open,
  onClose,
  title,
  width = 360,
  children,
}: SidePanelProps) {
  return (
    <>
      {/* scrim */}
      <div
        onClick={onClose}
        style={{
          position: "absolute",
          inset: 0,
          background: "rgba(0,0,0,0.38)",
          opacity: open ? 1 : 0,
          pointerEvents: open ? "auto" : "none",
          transition: "opacity .18s ease",
          zIndex: 40,
        }}
      />
      {/* panel — pinned to the logical-end edge */}
      <aside
        aria-hidden={!open}
        style={{
          position: "absolute",
          insetBlock: 0,
          insetInlineEnd: 0,
          width,
          maxWidth: "92%",
          display: "flex",
          flexDirection: "column",
          background: "rgba(10,11,13,0.96)",
          borderInlineStart: `1px solid ${T.glassBorder}`,
          backdropFilter: "blur(30px) saturate(1.7)",
          WebkitBackdropFilter: "blur(30px) saturate(1.7)",
          boxShadow: "-12px 0 40px rgba(0,0,0,0.45)",
          transform: open ? "translateX(0)" : "translateX(-100%)",
          transition: "transform .2s ease",
          zIndex: 41,
        }}
      >
        <header
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
            height: 48,
            padding: "0 14px",
            borderBottom: `0.5px solid ${T.hairline}`,
            flexShrink: 0,
          }}
        >
          <div style={{ fontSize: 14, fontWeight: 600, color: T.text }}>{title}</div>
          <button
            type="button"
            aria-label="סגור"
            onClick={onClose}
            style={{
              width: 28,
              height: 28,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              border: "none",
              background: "transparent",
              borderRadius: 6,
              color: T.muted,
              cursor: "pointer",
            }}
          >
            <X size={16} />
          </button>
        </header>
        <div style={{ flex: 1, overflowY: "auto", padding: 14 }}>{children}</div>
      </aside>
    </>
  );
}
