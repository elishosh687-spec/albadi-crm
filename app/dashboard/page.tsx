import { db } from "@/lib/db";
import { escalations, decisions, botRuns, repliesSent } from "@/drizzle/schema";
import { desc, isNull, sql } from "drizzle-orm";
import Link from "next/link";
import { Page } from "@/components/ui/Page";
import { Card } from "@/components/ui/Card";
import { Stat, StatRow } from "@/components/ui/Stat";
import { ActionButtons } from "@/components/dashboard/ActionButtons";
import { colors, fontStack, size, space, weight } from "@/lib/ui/tokens";

export const dynamic = "force-dynamic";

async function getStats() {
  const [openEscalationsCount, todayDecisions, todayReplies, lastRun] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(escalations)
      .where(isNull(escalations.resolvedAt)),
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
    openEscalationsCount: openEscalationsCount[0]?.count ?? 0,
    todayDecisions: todayDecisions[0]?.count ?? 0,
    todayReplies: todayReplies[0]?.count ?? 0,
    lastRun: lastRun[0],
  };
}

export default async function DashboardHome() {
  const { openEscalationsCount, todayDecisions, todayReplies, lastRun } = await getStats();
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
        title="פעילות הבוט"
        eyebrow="24 שעות אחרונות"
        actions={
          openEscalationsCount > 0 && (
            <Link
              href="/dashboard/escalations"
              style={{ fontSize: size.sm, fontFamily: fontStack.body, fontWeight: weight.medium }}
            >
              עבור להסלמות ←
            </Link>
          )
        }
      >
        <StatRow>
          <Stat label="הסלמות פתוחות" value={openEscalationsCount} />
          <Stat label="החלטות" value={todayDecisions} />
          <Stat label="הודעות נשלחו" value={todayReplies} />
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
