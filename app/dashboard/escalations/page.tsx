import { db } from "@/lib/db";
import { escalations } from "@/drizzle/schema";
import { desc, isNull, isNotNull, sql } from "drizzle-orm";
import { EscalationCard } from "./EscalationCard";

export const dynamic = "force-dynamic";

export default async function EscalationsPage() {
  const [open, closed] = await Promise.all([
    db
      .select()
      .from(escalations)
      .where(isNull(escalations.resolvedAt))
      .orderBy(desc(escalations.createdAt)),
    db
      .select()
      .from(escalations)
      .where(isNotNull(escalations.resolvedAt))
      .orderBy(desc(escalations.resolvedAt))
      .limit(20),
  ]);

  return (
    <div>
      <h1 style={{ margin: 0, fontSize: 28 }}>הסלמות</h1>

      <h2 style={{ marginTop: 24, fontSize: 16 }}>
        🟡 פתוחות ({open.length})
      </h2>
      {open.length === 0 ? (
        <p style={{ color: "#888" }}>אין הסלמות פתוחות.</p>
      ) : (
        open.map((e) => <EscalationCard key={e.id} escalation={{
          id: e.id,
          leadName: e.leadName ?? null,
          manychatSubId: e.manychatSubId,
          reason: e.reason,
          triggerText: e.triggerText ?? null,
          createdAt: e.createdAt.toISOString(),
        }} />)
      )}

      <h2 style={{ marginTop: 32, fontSize: 16, color: "#888" }}>
        ⚪ סגורות (אחרונות {closed.length})
      </h2>
      {closed.map((e) => (
        <div
          key={e.id}
          style={{
            padding: 12,
            borderBottom: "1px solid #eee",
            color: "#888",
            fontSize: 13,
          }}
        >
          <strong>{e.leadName ?? e.manychatSubId}</strong> — {e.reason}
          {" "}— {e.resolutionNote ?? "טופל"}
          {e.resolvedAt && ` (${new Date(e.resolvedAt).toLocaleString("he-IL")})`}
        </div>
      ))}
    </div>
  );
}
