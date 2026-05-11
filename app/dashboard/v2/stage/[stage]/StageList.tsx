"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { colors, fontStack, size, space, weight } from "@/lib/ui/tokens";
import { NotesModal, type NotesModalTarget } from "../../NotesModal";

const FLAG_TONES: Record<string, "danger" | "warning" | "info" | "accent" | "neutral"> = {
  "דחוף": "danger",
  "עסקה_גדולה": "accent",
  "ביקש_שיחה": "warning",
  "אחרי_החג": "info",
  "מועדף": "accent",
};

export interface StageLeadRow {
  manychatSubId: string;
  name: string | null;
  flags: string[];
  summary: string | null;
  daysSince: number | null;
  notes: string | null;
  currentStage: string | null;
}

export function StageList({
  rows,
  isUnclassified,
}: {
  rows: StageLeadRow[];
  isUnclassified: boolean;
}) {
  const [target, setTarget] = useState<NotesModalTarget | null>(null);

  if (rows.length === 0) {
    return (
      <p
        style={{
          fontFamily: fontStack.body,
          fontSize: size.md,
          color: colors.inkMuted,
          margin: 0,
        }}
      >
        אין לידים ב-stage הזה.
      </p>
    );
  }

  return (
    <div>
      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          fontFamily: fontStack.body,
          fontSize: size.sm,
        }}
      >
        <thead>
          <tr style={{ textAlign: "right", color: colors.inkMuted }}>
            <th style={th}>שם</th>
            <th style={th}>sub_id</th>
            <th style={th}>flags</th>
            {!isUnclassified && <th style={th}>ימים מאז עדכון</th>}
            <th style={th}>סיכום</th>
            <th style={th}>פעולות</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const cleanSid = r.manychatSubId.trim();
            return (
              <tr
                key={r.manychatSubId}
                style={{ borderTop: `1px solid ${colors.ruleSoft}`, verticalAlign: "top" }}
              >
                <td style={{ ...td, color: colors.ink, fontWeight: weight.medium }}>
                  {r.name ?? cleanSid}
                </td>
                <td style={{ ...td, color: colors.inkSubtle, fontFamily: "ui-monospace, monospace", fontSize: size.xs }}>
                  {cleanSid}
                </td>
                <td style={td}>
                  <span style={{ display: "inline-flex", flexWrap: "wrap", gap: space.xs }}>
                    {r.flags.map((f) => (
                      <Badge key={f} tone={FLAG_TONES[f] ?? "neutral"}>
                        {f}
                      </Badge>
                    ))}
                  </span>
                </td>
                {!isUnclassified && (
                  <td style={{ ...td, color: colors.inkMuted }}>
                    {r.daysSince !== null ? `${r.daysSince}d` : "—"}
                  </td>
                )}
                <td style={{ ...td, color: colors.inkMuted, maxWidth: 380 }}>
                  {r.summary ?? "—"}
                </td>
                <td style={td}>
                  <div style={{ display: "flex", gap: space.md, flexWrap: "wrap" }}>
                    <button
                      type="button"
                      onClick={() =>
                        setTarget({
                          manychatSubId: cleanSid,
                          leadName: r.name,
                          initialNotes: r.notes,
                          suggestionId: null,
                          suggestedStage: null,
                          currentStage: r.currentStage,
                          currentFlags: r.flags,
                        })
                      }
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
                      ✎ הערות / שנה stage
                    </button>
                    <a
                      href={`https://app.manychat.com/fb4499581/chat/${encodeURIComponent(cleanSid)}`}
                      target="_blank"
                      rel="noreferrer"
                      style={{
                        fontFamily: fontStack.body,
                        fontSize: size.sm,
                        color: colors.accent,
                      }}
                    >
                      Live Chat ↗
                    </a>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <NotesModal target={target} onClose={() => setTarget(null)} />
    </div>
  );
}

const th: React.CSSProperties = {
  padding: `${space.sm}px ${space.sm}px`,
  fontWeight: weight.medium,
};
const td: React.CSSProperties = {
  padding: `${space.sm}px ${space.sm}px`,
};
