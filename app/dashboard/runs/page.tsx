import { db } from "@/lib/db";
import { botRuns } from "@/drizzle/schema";
import { desc } from "drizzle-orm";

export const dynamic = "force-dynamic";

export default async function RunsPage() {
  const runs = await db.select().from(botRuns).orderBy(desc(botRuns.startedAt)).limit(50);

  return (
    <div>
      <h1 style={{ margin: 0, fontSize: 28 }}>היסטוריית ריצות</h1>

      {runs.length === 0 ? (
        <p style={{ color: "#888", marginTop: 16 }}>הבוט עדיין לא רץ.</p>
      ) : (
        <table style={{ width: "100%", marginTop: 16, borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "#f7f7f8" }}>
              <th style={th()}>זמן</th>
              <th style={th()}>סטטוס</th>
              <th style={th()}>לידים</th>
              <th style={th()}>החלטות</th>
              <th style={th()}>תגובות</th>
              <th style={th()}>הסלמות</th>
              <th style={th()}>שגיאות</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r.id} style={{ borderBottom: "1px solid #eee" }}>
                <td style={td()}>{new Date(r.startedAt).toLocaleString("he-IL")}</td>
                <td style={td()}>
                  <StatusBadge status={r.status} />
                </td>
                <td style={td()}>{r.leadsSeen ?? 0}</td>
                <td style={td()}>{r.decisions ?? 0}</td>
                <td style={td()}>{r.repliesSent ?? 0}</td>
                <td style={td()}>{r.escalations ?? 0}</td>
                <td style={td()}>{r.errors ?? 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string | null }) {
  const map: Record<string, { color: string; bg: string; label: string }> = {
    success: { color: "#2d7a3a", bg: "#f0f9f4", label: "הצליח" },
    partial: { color: "#a05a00", bg: "#fff8eb", label: "חלקי" },
    failed: { color: "#c1272d", bg: "#fee9e9", label: "נכשל" },
    running: { color: "#0066cc", bg: "#eff5ff", label: "רץ עכשיו" },
  };
  const s = (status && map[status]) || { color: "#888", bg: "#f0f0f0", label: status ?? "?" };
  return (
    <span
      style={{
        background: s.bg,
        color: s.color,
        padding: "2px 8px",
        borderRadius: 4,
        fontSize: 12,
      }}
    >
      {s.label}
    </span>
  );
}

function th(): React.CSSProperties {
  return { textAlign: "right", padding: 10, fontSize: 13, color: "#666", fontWeight: 600 };
}
function td(): React.CSSProperties {
  return { padding: 10, fontSize: 13 };
}
