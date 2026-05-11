"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { colors, fontStack, size, space, weight } from "@/lib/ui/tokens";
import { NotesEditor } from "../../NotesEditor";

const FLAG_TONES: Record<string, "danger" | "warning" | "info" | "accent" | "neutral"> = {
  "דחוף": "danger",
  "עסקה_גדולה": "accent",
  "ביקש_שיחה": "warning",
  "אחרי_החג": "info",
  "מועדף": "accent",
};

export interface StageRowData {
  manychatSubId: string;
  name: string | null;
  flags: string[];
  summary: string | null;
  daysSince: number | null;
  notes: string | null;
  isUnclassified: boolean;
}

export function StageRow({ data }: { data: StageRowData }) {
  const [expanded, setExpanded] = useState(false);
  const cleanSid = data.manychatSubId.trim();

  return (
    <div
      style={{
        borderTop: `1px solid ${colors.ruleSoft}`,
        padding: `${space.sm}px 0`,
        fontFamily: fontStack.body,
        fontSize: size.sm,
      }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1.5fr 1fr 1.2fr 0.5fr 2fr auto",
          gap: space.md,
          alignItems: "center",
        }}
      >
        <div style={{ color: colors.ink, fontWeight: weight.medium }}>
          {data.name ?? cleanSid}
        </div>
        <div style={{ color: colors.inkSubtle, fontFamily: "ui-monospace, monospace", fontSize: size.xs }}>
          {cleanSid}
        </div>
        <div style={{ display: "inline-flex", flexWrap: "wrap", gap: space.xs }}>
          {data.flags.map((f) => (
            <Badge key={f} tone={FLAG_TONES[f] ?? "neutral"}>
              {f}
            </Badge>
          ))}
        </div>
        <div style={{ color: colors.inkMuted }}>
          {!data.isUnclassified && data.daysSince !== null ? `${data.daysSince}d` : "—"}
        </div>
        <div
          style={{
            color: colors.inkMuted,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
          title={data.summary ?? ""}
        >
          {data.summary ?? "—"}
        </div>
        <div style={{ display: "flex", gap: space.sm }}>
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            style={{
              fontFamily: fontStack.body,
              fontSize: size.sm,
              color: colors.accent,
              background: "transparent",
              border: "none",
              cursor: "pointer",
              padding: 0,
            }}
          >
            {expanded ? "סגור ▲" : "notes ▼"}
          </button>
          <a
            href={`https://app.manychat.com/fb4499581/chat/${encodeURIComponent(cleanSid)}`}
            target="_blank"
            rel="noreferrer"
            style={{ color: colors.accent }}
          >
            Chat ↗
          </a>
        </div>
      </div>

      {expanded && (
        <div style={{ marginTop: space.sm, paddingInlineStart: space.md }}>
          <NotesEditor manychatSubId={cleanSid} initialNotes={data.notes} />
        </div>
      )}
    </div>
  );
}
