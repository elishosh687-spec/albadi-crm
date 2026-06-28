"use client";

/**
 * Toolbar — a flex filter-bar container. Children fill the start; optional
 * `search` and `sort` slots pin to the logical end.
 * Presentation-only.
 */

import { T } from "./tokens";

export interface ToolbarProps {
  children?: React.ReactNode;
  /** pinned to the logical-end side (e.g. a search affordance) */
  search?: React.ReactNode;
  /** pinned to the logical-end side after search (e.g. a sort control) */
  sort?: React.ReactNode;
}

export default function Toolbar({ children, search, sort }: ToolbarProps) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        minHeight: 44,
        padding: "6px 14px",
        borderBottom: `0.5px solid ${T.hairline}`,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 0 }}>
        {children}
      </div>
      {search && <div style={{ flexShrink: 0 }}>{search}</div>}
      {sort && <div style={{ flexShrink: 0 }}>{sort}</div>}
    </div>
  );
}
