"use client";

/**
 * SavedViews — a horizontal row of filter chips with optional counts.
 * Presentation-only: caller owns the active state + onSelect.
 */

import { T } from "./tokens";

export interface SavedView {
  id: string;
  label: string;
  count?: number;
  active?: boolean;
}

export interface SavedViewsProps {
  views: SavedView[];
  onSelect?: (id: string) => void;
}

export default function SavedViews({ views, onSelect }: SavedViewsProps) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
      {views.map((v) => {
        const active = !!v.active;
        return (
          <button
            key={v.id}
            type="button"
            onClick={onSelect ? () => onSelect(v.id) : undefined}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              height: 28,
              padding: "0 10px",
              fontSize: 12.5,
              fontWeight: active ? 600 : 500,
              borderRadius: 6,
              cursor: "pointer",
              whiteSpace: "nowrap",
              background: active ? T.champFill : "transparent",
              border: `1px solid ${active ? T.champBorder : "transparent"}`,
              color: active ? T.champ : T.muted,
            }}
          >
            {v.label}
            {typeof v.count === "number" && (
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  fontVariantNumeric: "tabular-nums",
                  color: active ? T.champ : T.faint,
                }}
              >
                {v.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
