import { db } from "@/lib/db";
import { escalations } from "@/drizzle/schema";
import { desc, isNull, isNotNull } from "drizzle-orm";
import { EscalationCard } from "./EscalationCard";
import { Page } from "@/components/ui/Page";
import { Card } from "@/components/ui/Card";
import { colors, fontStack, leading, size, space, weight } from "@/lib/ui/tokens";

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
      <Page
        title="הסלמות"
        description="לידים שהבוט לא יכול לטפל בהם לבד — נושאי מחיר, בקשות לשיחה, או כל מקרה שדורש שיקול דעת אנושי."
      />

      <Card title="פתוחות" eyebrow={`${open.length} ממתינות`}>
        {open.length === 0 ? (
          <p style={emptyStyle}>אין הסלמות פתוחות.</p>
        ) : (
          open.map((e) => (
            <EscalationCard
              key={e.id}
              escalation={{
                id: e.id,
                leadName: e.leadName ?? null,
                manychatSubId: e.manychatSubId,
                reason: e.reason,
                triggerText: e.triggerText ?? null,
                createdAt: e.createdAt.toISOString(),
              }}
            />
          ))
        )}
      </Card>

      <Card title="סגורות" eyebrow={`אחרונות ${closed.length}`}>
        {closed.length === 0 ? (
          <p style={emptyStyle}>אין הסלמות סגורות עדיין.</p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {closed.map((e, i) => (
              <li
                key={e.id}
                style={{
                  borderTop: i === 0 ? "none" : `1px solid ${colors.ruleSoft}`,
                  padding: `${space.md}px 0`,
                  display: "flex",
                  justifyContent: "space-between",
                  gap: space.lg,
                  fontSize: size.sm,
                  color: colors.inkMuted,
                  lineHeight: leading.normal,
                  fontFamily: fontStack.body,
                }}
              >
                <div>
                  <strong style={{ color: colors.ink, fontWeight: weight.medium }}>
                    {e.leadName ?? e.manychatSubId}
                  </strong>{" "}
                  — {e.reason} — {e.resolutionNote ?? "טופל"}
                </div>
                {e.resolvedAt && (
                  <span style={{ fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>
                    {new Date(e.resolvedAt).toLocaleString("he-IL")}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

const emptyStyle: React.CSSProperties = {
  fontFamily: fontStack.body,
  fontSize: size.md,
  color: colors.inkMuted,
  margin: 0,
  padding: `${space.lg}px 0`,
};
