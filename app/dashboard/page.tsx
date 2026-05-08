import { db } from "@/lib/db";
import { escalations, decisions, botRuns, repliesSent } from "@/drizzle/schema";
import { desc, eq, isNull, sql } from "drizzle-orm";
import Link from "next/link";
import { Page } from "@/components/ui/Page";
import { Card } from "@/components/ui/Card";
import { Stat, StatRow } from "@/components/ui/Stat";
import { Badge, Dot } from "@/components/ui/Badge";
import { ActionButtons } from "@/components/dashboard/ActionButtons";
import { colors, fontStack, leading, size, space, weight } from "@/lib/ui/tokens";

export const dynamic = "force-dynamic";

const REASON_HE: Record<string, string> = {
  low_confidence: "Claude לא בטוחה",
  human_request: "ביקש שיחה אישית",
  pricing: "נושא מחיר/הנחה",
  complaint: "תלונה",
  unknown: "לא מוכר / שבור",
};

const REASON_TONE: Record<string, "warning" | "danger" | "accent" | "neutral"> = {
  low_confidence: "warning",
  human_request: "accent",
  pricing: "warning",
  complaint: "danger",
  unknown: "neutral",
};

async function getStats() {
  const [openEscalations, todayDecisions, todayReplies, lastRun] = await Promise.all([
    db
      .select({
        id: escalations.id,
        leadName: escalations.leadName,
        reason: escalations.reason,
        triggerText: escalations.triggerText,
        createdAt: escalations.createdAt,
        manychatSubId: escalations.manychatSubId,
        inputMessages: decisions.inputMessages,
      })
      .from(escalations)
      .leftJoin(decisions, eq(escalations.decisionId, decisions.id))
      .where(isNull(escalations.resolvedAt))
      .orderBy(desc(escalations.createdAt))
      .limit(20),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(decisions)
      .where(sql`${decisions.createdAt} >= now() - interval '24 hours'`),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(repliesSent)
      .where(sql`${repliesSent.sentAt} >= now() - interval '24 hours'`),
    db.select().from(botRuns).orderBy(desc(botRuns.startedAt)).limit(1),
  ]);

  return {
    openEscalations,
    todayDecisions: todayDecisions[0]?.count ?? 0,
    todayReplies: todayReplies[0]?.count ?? 0,
    lastRun: lastRun[0],
  };
}

export default async function DashboardHome() {
  const { openEscalations, todayDecisions, todayReplies, lastRun } = await getStats();
  const today = new Date();
  const dateLabel = today.toLocaleDateString("he-IL", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return (
    <div>
      <Page
        eyebrow={dateLabel}
        title="בית"
        description="סקירה יומית של פעילות הבוט והלידים שמחכים לטיפול ידני."
      />

      <ActionButtons />

      <Card
        title={`לקוחות מחכים לטיפול`}
        eyebrow={`${openEscalations.length} פתוחות`}
        actions={
          openEscalations.length > 0 && (
            <Link
              href="/dashboard/escalations"
              style={{ fontSize: size.sm, fontFamily: fontStack.body, fontWeight: weight.medium }}
            >
              עבור לכל ההסלמות ←
            </Link>
          )
        }
      >
        {openEscalations.length === 0 ? (
          <p style={emptyStyle}>אין הסלמות פתוחות. הבוט מטפל בכל הלידים אוטומטית.</p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {openEscalations.map((e, i) => {
              const input = (e.inputMessages ?? {}) as {
                currentTag?: string | null;
                daysSinceContact?: number | null;
                quoteTotal?: number | null;
              };
              const meta: string[] = [];
              if (input.currentTag) meta.push(input.currentTag.replace(/_/g, " "));
              if (input.daysSinceContact != null) meta.push(`${input.daysSinceContact} ימים שקט`);
              if (input.quoteTotal != null && input.quoteTotal > 0)
                meta.push(`₪${input.quoteTotal.toLocaleString("he-IL")}`);
              return (
                <li
                  key={e.id}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: space.lg,
                    padding: `${space.md}px 0`,
                    borderTop: i === 0 ? "none" : `1px solid ${colors.ruleSoft}`,
                  }}
                >
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div
                      style={{
                        display: "flex",
                        gap: space.sm,
                        alignItems: "center",
                        flexWrap: "wrap",
                        marginBottom: 2,
                      }}
                    >
                      <Dot tone={REASON_TONE[e.reason] ?? "neutral"} />
                      <strong style={{ fontSize: size.md, fontWeight: weight.semibold }}>
                        {e.leadName ?? e.manychatSubId}
                      </strong>
                      <Badge tone={REASON_TONE[e.reason] ?? "neutral"}>
                        {REASON_HE[e.reason] ?? e.reason}
                      </Badge>
                    </div>
                    {meta.length > 0 && (
                      <div
                        style={{
                          color: colors.inkMuted,
                          fontSize: size.xs,
                          marginInlineStart: space.lg,
                          marginTop: space.xs,
                          fontVariantNumeric: "tabular-nums",
                        }}
                      >
                        {meta.join(" · ")}
                      </div>
                    )}
                    {e.triggerText && (
                      <div
                        style={{
                          color: colors.ink,
                          fontSize: size.sm,
                          marginInlineStart: space.lg,
                          marginTop: space.xs,
                          lineHeight: leading.normal,
                        }}
                      >
                        {e.triggerText}
                      </div>
                    )}
                  </div>
                  <Link
                    href={`/dashboard/escalations#e-${e.id}`}
                    style={{
                      fontFamily: fontStack.body,
                      fontSize: size.sm,
                      fontWeight: weight.medium,
                      color: colors.ink,
                      border: `1px solid ${colors.rule}`,
                      padding: `${space.xs}px ${space.md}px`,
                      borderRadius: 6,
                      flexShrink: 0,
                    }}
                  >
                    טפל
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card title="פעילות הבוט" eyebrow="24 שעות אחרונות">
        <StatRow>
          <Stat label="החלטות" value={todayDecisions} />
          <Stat label="הודעות נשלחו" value={todayReplies} />
          <Stat label="הסלמות פתוחות" value={openEscalations.length} />
        </StatRow>
        <p
          style={{
            fontFamily: fontStack.body,
            fontSize: size.sm,
            color: colors.inkMuted,
            marginTop: space.xl,
            marginBottom: 0,
          }}
        >
          {lastRun ? (
            <>
              ריצה אחרונה:{" "}
              <span style={{ fontVariantNumeric: "tabular-nums" }}>
                {new Date(lastRun.startedAt).toLocaleString("he-IL")}
              </span>{" "}
              — {lastRun.status ?? "—"}
            </>
          ) : (
            <>הבוט עדיין לא רץ. השתמש בכפתור &quot;הרץ בוט עכשיו&quot; למעלה כדי להתחיל.</>
          )}
        </p>
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
