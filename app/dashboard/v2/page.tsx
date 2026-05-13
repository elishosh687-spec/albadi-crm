import Link from "next/link";
import { db } from "@/lib/db";
import { leads } from "@/drizzle/schema";
import { eq, sql } from "drizzle-orm";
import { Page } from "@/components/ui/Page";
import { Card } from "@/components/ui/Card";
import { colors, fontStack, size, space, weight } from "@/lib/ui/tokens";
import { V2_PIPELINE_STAGES } from "@/lib/manychat/config";
import { NeedsEliCard, type NeedsEliLead } from "./NeedsEliCard";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

export default async function DashboardV2() {
  const [activeLeads, needsEliRows] = await Promise.all([
    db
      .select({
        id: leads.manychatSubId,
        stage: leads.pipelineStage,
      })
      .from(leads)
      .where(eq(leads.active, true)),
    db
      .select({
        sid: leads.manychatSubId,
        name: leads.name,
        phone: leads.phoneE164,
        stage: leads.pipelineStage,
        flag: leads.pipelineFlag,
        botPaused: leads.botPaused,
        followUpCount: leads.followUpCount,
      })
      .from(leads)
      .where(sql`${leads.active} = true AND (${leads.pipelineFlag} = 'NEEDS_ELI' OR ${leads.botPaused} = true)`),
  ]);

  const needsEliLeads: NeedsEliLead[] = needsEliRows.map((r) => ({
    sid: r.sid,
    name: r.name,
    phone: r.phone,
    stage: r.stage,
    flag: r.flag,
    botPaused: r.botPaused,
    followUpCount: r.followUpCount,
  }));

  const stageCounts: Record<string, number> = {};
  for (const stage of V2_PIPELINE_STAGES) stageCounts[stage] = 0;
  stageCounts["UNCLASSIFIED"] = 0;
  for (const r of activeLeads) {
    const stage = (r.stage ?? "").trim();
    if (stage && (V2_PIPELINE_STAGES as readonly string[]).includes(stage)) {
      stageCounts[stage] = (stageCounts[stage] ?? 0) + 1;
    } else {
      stageCounts["UNCLASSIFIED"] = (stageCounts["UNCLASSIFIED"] ?? 0) + 1;
    }
  }

  return (
    <div>
      <Page
        title="דאשבורד v2"
        description="הבוט מנהל את השאלון, ההצעה, החלטות הלקוח והפולואפים. אתה מטפל רק במה שמסומן NEEDS_ELI."
      />

      <NeedsEliCard leads={needsEliLeads} />

      <Card title="Pipeline — סיכום">
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: space.lg,
            fontFamily: fontStack.body,
            fontSize: size.sm,
          }}
        >
          {Object.entries(stageCounts).map(([stage, count]) => {
            if (count === 0) return null;
            return (
              <Link
                key={stage}
                href={`/dashboard/v2/stage/${encodeURIComponent(stage)}`}
                style={{
                  border: `1px solid ${colors.rule}`,
                  borderRadius: 6,
                  padding: `${space.sm}px ${space.md}px`,
                  minWidth: 110,
                  textDecoration: "none",
                  color: "inherit",
                  display: "block",
                }}
              >
                <div style={{ color: colors.inkMuted, fontSize: size.xs }}>{stage}</div>
                <div
                  style={{
                    fontFamily: fontStack.display,
                    fontSize: size.xl,
                    fontWeight: weight.medium,
                    color: colors.ink,
                  }}
                >
                  {count}
                </div>
              </Link>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
