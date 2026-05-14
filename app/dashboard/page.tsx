import { db } from "@/lib/db";
import { leads, messages } from "@/drizzle/schema";
import { eq, gte, sql, and } from "drizzle-orm";
import Link from "next/link";
import { Page } from "@/components/ui/Page";
import { Card } from "@/components/ui/Card";
import { Stat, StatRow } from "@/components/ui/Stat";
import { colors, fontStack, size, space, weight } from "@/lib/ui/tokens";
import { V2Chrome } from "./_components/V2Chrome";

export const dynamic = "force-dynamic";

async function getStats() {
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [needsEli, activeLeads, msgsToday] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(leads)
      .where(
        and(eq(leads.active, true), eq(leads.pipelineFlag, "NEEDS_ELI"))
      ),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(leads)
      .where(eq(leads.active, true)),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(messages)
      .where(gte(messages.receivedAt, dayAgo)),
  ]);

  return {
    needsEli: needsEli[0]?.count ?? 0,
    activeLeads: activeLeads[0]?.count ?? 0,
    msgsToday: msgsToday[0]?.count ?? 0,
  };
}

export default async function DashboardHome() {
  const { needsEli, activeLeads, msgsToday } = await getStats();
  const today = new Date();
  const dateLabel = today.toLocaleDateString("he-IL", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return (
    <V2Chrome>
    <div>
      <Page
        eyebrow={dateLabel}
        title="בית"
        description="סיכום פעילות. ניהול לידים מתבצע בעמוד v2."
      />

      <Card
        title="סקירה"
        eyebrow="24 שעות אחרונות"
        actions={
          needsEli > 0 ? (
            <Link
              href="/dashboard/v2"
              style={{
                fontSize: size.sm,
                fontFamily: fontStack.body,
                fontWeight: weight.medium,
              }}
            >
              צריך אותך ←
            </Link>
          ) : null
        }
      >
        <StatRow>
          <Stat label="צריך אותך" value={needsEli} />
          <Stat label="לידים פעילים" value={activeLeads} />
          <Stat label="הודעות נכנסות" value={msgsToday} />
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
          הבוט מנהל את השאלון, ההצעה, החלטות הלקוח והפולואפים אוטומטית.
          לידים שסומנו <code>NEEDS_ELI</code> מחכים לטיפול ידני בדאשבורד v2.
        </p>
      </Card>
    </div>
    </V2Chrome>
  );
}
