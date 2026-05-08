import { db } from "@/lib/db";
import { botRuns } from "@/drizzle/schema";
import { desc } from "drizzle-orm";
import { Page } from "@/components/ui/Page";
import { Badge } from "@/components/ui/Badge";
import { colors, fontStack, size, space, weight } from "@/lib/ui/tokens";

export const dynamic = "force-dynamic";

export default async function RunsPage() {
  const runs = await db.select().from(botRuns).orderBy(desc(botRuns.startedAt)).limit(50);

  return (
    <div>
      <Page
        title="היסטוריית ריצות"
        description="50 הריצות האחרונות של הבוט. כל ריצה היא סבב סיווג של כל הלידים הפעילים."
      />

      {runs.length === 0 ? (
        <p style={emptyStyle}>הבוט עדיין לא רץ.</p>
      ) : (
        <div style={{ overflowX: "auto", marginTop: space.lg }}>
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontFamily: fontStack.body,
              fontSize: size.sm,
            }}
          >
            <thead>
              <tr style={{ borderBottom: `1px solid ${colors.rule}` }}>
                <th style={th}>זמן</th>
                <th style={th}>סטטוס</th>
                <th style={thNum}>לידים</th>
                <th style={thNum}>החלטות</th>
                <th style={thNum}>תגובות</th>
                <th style={thNum}>הסלמות</th>
                <th style={thNum}>שגיאות</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr
                  key={r.id}
                  style={{
                    borderBottom: `1px solid ${colors.ruleSoft}`,
                  }}
                >
                  <td
                    style={{
                      ...td,
                      fontVariantNumeric: "tabular-nums",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {new Date(r.startedAt).toLocaleString("he-IL")}
                  </td>
                  <td style={td}>
                    <StatusBadge status={r.status} />
                  </td>
                  <td style={tdNum}>{r.leadsSeen ?? 0}</td>
                  <td style={tdNum}>{r.decisions ?? 0}</td>
                  <td style={tdNum}>{r.repliesSent ?? 0}</td>
                  <td style={tdNum}>{r.escalations ?? 0}</td>
                  <td
                    style={{
                      ...tdNum,
                      color: (r.errors ?? 0) > 0 ? colors.danger : colors.inkMuted,
                    }}
                  >
                    {r.errors ?? 0}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string | null }) {
  const map: Record<string, { tone: "success" | "warning" | "danger" | "info" | "neutral"; label: string }> = {
    success: { tone: "success", label: "הצליח" },
    partial: { tone: "warning", label: "חלקי" },
    failed: { tone: "danger", label: "נכשל" },
    running: { tone: "info", label: "רץ עכשיו" },
  };
  const s = (status && map[status]) || { tone: "neutral" as const, label: status ?? "—" };
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

const th: React.CSSProperties = {
  textAlign: "start",
  padding: `${space.sm}px ${space.md}px ${space.sm}px 0`,
  fontSize: size.xs,
  fontWeight: weight.medium,
  color: colors.inkMuted,
  letterSpacing: "0.12em",
  textTransform: "uppercase",
};

const thNum: React.CSSProperties = {
  ...th,
  textAlign: "end",
  paddingInlineStart: space.md,
};

const td: React.CSSProperties = {
  padding: `${space.md}px ${space.md}px ${space.md}px 0`,
  color: colors.ink,
  fontSize: size.sm,
};

const tdNum: React.CSSProperties = {
  ...td,
  textAlign: "end",
  fontVariantNumeric: "tabular-nums",
  paddingInlineStart: space.md,
};

const emptyStyle: React.CSSProperties = {
  fontFamily: fontStack.body,
  fontSize: size.md,
  color: colors.inkMuted,
  margin: 0,
  padding: `${space.lg}px 0`,
};
