"use client";

/**
 * DataTable — generic dense table with hairline dividers and a hover-revealed
 * row-actions slot. Presentation-only: receives columns + rows via props.
 *
 * NO per-row button walls — use the `rowActions` render prop (typically a
 * <RowActions/> trigger) which only appears on row hover.
 */

import { useId } from "react";
import { T } from "./tokens";

export interface DataTableColumn<R> {
  key: string;
  label: string;
  align?: "start" | "center" | "end";
  /** grid track width, e.g. "1.7fr" | "0.8fr" | "28px" */
  width?: string;
  /** apply tabular-nums (numeric columns) */
  numeric?: boolean;
  render?: (row: R) => React.ReactNode;
}

export interface DataTableProps<R> {
  columns: DataTableColumn<R>[];
  rows: R[];
  /** stable key extractor; defaults to index */
  rowKey?: (row: R, index: number) => string | number;
  onRowClick?: (row: R, index: number) => void;
  /** hover-revealed actions slot (e.g. a <RowActions/> trigger) rendered at row end */
  rowActions?: (row: R, index: number) => React.ReactNode;
  stickyHeader?: boolean;
  /** shown when rows is empty */
  empty?: React.ReactNode;
}

export default function DataTable<R>({
  columns,
  rows,
  rowKey,
  onRowClick,
  rowActions,
  stickyHeader = false,
  empty,
}: DataTableProps<R>) {
  const uid = useId().replace(/:/g, "");
  const cls = `dt-${uid}`;

  const cols = rowActions
    ? [...columns, { key: "__actions__", label: "", width: "28px", align: "end" as const }]
    : columns;

  const gridTemplate = cols.map((c) => c.width ?? "1fr").join(" ");

  return (
    <div className={cls} style={{ width: "100%" }}>
      <style>{`
        .${cls} .dt-actions { opacity: 0; transition: opacity .12s ease; }
        .${cls} .dt-row:hover { background: ${T.rowHover}; }
        .${cls} .dt-row:hover .dt-actions { opacity: 1; }
      `}</style>

      {/* header */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: gridTemplate,
          alignItems: "center",
          gap: 12,
          padding: "0 14px",
          height: 30,
          position: stickyHeader ? "sticky" : undefined,
          top: stickyHeader ? 0 : undefined,
          zIndex: stickyHeader ? 5 : undefined,
          background: stickyHeader ? T.bg : undefined,
        }}
      >
        {cols.map((c) => (
          <div
            key={c.key}
            style={{
              fontSize: 11,
              color: T.faint,
              fontWeight: 500,
              textAlign: c.align ?? "start",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {c.label}
          </div>
        ))}
      </div>

      {/* body */}
      {rows.length === 0
        ? empty != null && (
            <div style={{ padding: "20px 14px", color: T.muted, fontSize: 13 }}>{empty}</div>
          )
        : rows.map((row, i) => (
            <div
              key={rowKey ? rowKey(row, i) : i}
              className="dt-row"
              onClick={onRowClick ? () => onRowClick(row, i) : undefined}
              style={{
                display: "grid",
                gridTemplateColumns: gridTemplate,
                alignItems: "center",
                gap: 12,
                padding: "0 14px",
                minHeight: 46,
                borderTop: `0.5px solid ${T.hairline}`,
                cursor: onRowClick ? "pointer" : "default",
              }}
            >
              {columns.map((c) => (
                <div
                  key={c.key}
                  style={{
                    textAlign: c.align ?? "start",
                    fontSize: 13,
                    color: T.text,
                    minWidth: 0,
                    fontVariantNumeric: c.numeric ? "tabular-nums" : undefined,
                  }}
                >
                  {c.render ? c.render(row) : ((row as Record<string, unknown>)[c.key] as React.ReactNode)}
                </div>
              ))}
              {rowActions && (
                <div className="dt-actions" style={{ textAlign: "end" }}>
                  {rowActions(row, i)}
                </div>
              )}
            </div>
          ))}
    </div>
  );
}
