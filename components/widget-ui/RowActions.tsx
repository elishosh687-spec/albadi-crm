"use client";

/**
 * RowActions — a single "⋯" trigger (lucide MoreHorizontal) that opens a
 * small menu of items. Replaces repeated per-row button walls.
 * Presentation-only: callers wire onClick handlers.
 */

import { useEffect, useRef, useState } from "react";
import { MoreHorizontal } from "lucide-react";
import { T, toneStyle, type Tone } from "./tokens";

export interface RowActionItem {
  label: string;
  icon?: React.ReactNode;
  onClick: () => void;
  tone?: Tone;
}

export interface RowActionsProps {
  items: RowActionItem[];
  /** when true the trigger is hidden until row hover (caller sets via CSS class) */
  triggerClassName?: string;
}

export default function RowActions({ items, triggerClassName }: RowActionsProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  return (
    <div ref={ref} style={{ position: "relative", display: "inline-flex" }}>
      <button
        type="button"
        aria-label="פעולות"
        className={triggerClassName}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        style={{
          width: 28,
          height: 28,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          border: "none",
          background: open ? "rgba(255,255,255,0.06)" : "transparent",
          borderRadius: 6,
          color: T.muted,
          cursor: "pointer",
          padding: 0,
        }}
      >
        <MoreHorizontal size={16} />
      </button>

      {open && (
        <div
          role="menu"
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            insetInlineEnd: 0,
            minWidth: 160,
            zIndex: 30,
            padding: 4,
            borderRadius: 8,
            background: "rgba(17,19,22,0.92)",
            border: `1px solid ${T.glassBorder}`,
            backdropFilter: "blur(30px) saturate(1.7)",
            WebkitBackdropFilter: "blur(30px) saturate(1.7)",
            boxShadow: "0 12px 40px rgba(0,0,0,0.45)",
          }}
        >
          {items.map((it, i) => {
            const tinted = it.tone ? toneStyle(it.tone).color : T.text;
            return (
              <button
                key={i}
                type="button"
                role="menuitem"
                onClick={(e) => {
                  e.stopPropagation();
                  setOpen(false);
                  it.onClick();
                }}
                style={{
                  width: "100%",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "7px 9px",
                  fontSize: 13,
                  textAlign: "start",
                  border: "none",
                  background: "transparent",
                  borderRadius: 6,
                  color: tinted,
                  cursor: "pointer",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "rgba(255,255,255,0.05)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "transparent";
                }}
              >
                {it.icon && (
                  <span style={{ display: "inline-flex", flexShrink: 0 }}>{it.icon}</span>
                )}
                {it.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
