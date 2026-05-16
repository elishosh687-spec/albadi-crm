import { db } from "@/lib/db";
import { botDrafts, leads, messages } from "@/drizzle/schema";
import { and, eq, gte, sql } from "drizzle-orm";
import { AnalyticsView, type AnalyticsData } from "./AnalyticsView";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 30;

const FUNNEL_ORDER = [
  "NEW",
  "AWAITING_ESTIMATE",
  "AWAITING_LOGO",
  "WAITING_FACTORY",
  "AWAITING_FINAL",
  "WON",
];

export default async function V3AnalyticsPage() {
  const now = new Date();
  const monthAgo = new Date(now.getTime() - 30 * 24 * 3600 * 1000);
  const weekAgo = new Date(now.getTime() - 7 * 24 * 3600 * 1000);
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);

  const [
    activeLeads,
    pipelineRows,
    pendingDrafts,
    monthDrafts,
    sentThisMonth,
    wonThisMonth,
    inboundLeadsMonth,
    newLeadsWeek,
    todayBotMessages,
    todayEliMessages,
    todayLeadMessages,
  ] = await Promise.all([
    db
      .select({ stage: leads.pipelineStage })
      .from(leads)
      .where(eq(leads.active, true)),
    db
      .select({
        stage: leads.pipelineStage,
        count: sql<number>`count(*)::int`,
      })
      .from(leads)
      .where(eq(leads.active, true))
      .groupBy(leads.pipelineStage),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(botDrafts)
      .where(eq(botDrafts.status, "pending")),
    db
      .select({
        status: botDrafts.status,
        count: sql<number>`count(*)::int`,
      })
      .from(botDrafts)
      .where(gte(botDrafts.generatedAt, monthAgo))
      .groupBy(botDrafts.status),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(botDrafts)
      .where(
        and(eq(botDrafts.status, "sent"), gte(botDrafts.generatedAt, monthAgo))
      ),
    db
      .select({
        sum: sql<number>`coalesce(sum(cast(${leads.quoteTotal} as numeric)), 0)`,
      })
      .from(leads)
      .where(
        and(eq(leads.pipelineStage, "WON"), gte(leads.updatedAt, monthAgo))
      ),
    db
      .select({
        count: sql<number>`count(distinct ${messages.manychatSubId})::int`,
      })
      .from(messages)
      .where(
        and(eq(messages.direction, "in"), gte(messages.receivedAt, monthAgo))
      ),
    db
      .select({
        count: sql<number>`count(distinct ${messages.manychatSubId})::int`,
      })
      .from(messages)
      .where(
        and(eq(messages.direction, "in"), gte(messages.receivedAt, weekAgo))
      ),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(messages)
      .where(
        and(eq(messages.sender, "bot"), gte(messages.receivedAt, todayStart))
      ),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(messages)
      .where(
        and(eq(messages.sender, "eli"), gte(messages.receivedAt, todayStart))
      ),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(messages)
      .where(
        and(eq(messages.sender, "lead"), gte(messages.receivedAt, todayStart))
      ),
  ]);

  // Funnel = count of leads that EVER passed through each stage (best-effort:
  // active leads counted by current stage; we don't have stage-history yet).
  const funnel = FUNNEL_ORDER.map((s) => {
    const row = pipelineRows.find((r) => (r.stage ?? "").toUpperCase() === s);
    return { stage: s, count: row?.count ?? 0 };
  });

  // Pipeline distribution (everything, not just funnel).
  const pipelineDist = pipelineRows
    .map((r) => ({
      stage: (r.stage ?? "UNCLASSIFIED").toUpperCase(),
      count: r.count,
    }))
    .filter((r) => r.count > 0)
    .sort((a, b) => b.count - a.count);

  const draftsMonthMap = new Map(monthDrafts.map((r) => [r.status, r.count]));
  const sent = draftsMonthMap.get("sent") ?? 0;
  const rejected = draftsMonthMap.get("rejected") ?? 0;
  const failed = draftsMonthMap.get("failed") ?? 0;
  const totalDecidedDrafts = sent + rejected;
  const approvalRate =
    totalDecidedDrafts > 0
      ? Math.round((sent / totalDecidedDrafts) * 1000) / 10
      : null;

  const data: AnalyticsData = {
    activeLeadsCount: activeLeads.length,
    newLeadsWeek: newLeadsWeek[0]?.count ?? 0,
    pendingDrafts: pendingDrafts[0]?.count ?? 0,
    wonMonthSumIls: Math.round(wonThisMonth[0]?.sum ?? 0),
    sentThisMonth: sentThisMonth[0]?.count ?? 0,
    inboundLeadsMonth: inboundLeadsMonth[0]?.count ?? 0,
    botApprovalRatePct: approvalRate,
    botDraftsMonth: { sent, rejected, failed },
    todayMessages: {
      bot: todayBotMessages[0]?.count ?? 0,
      eli: todayEliMessages[0]?.count ?? 0,
      lead: todayLeadMessages[0]?.count ?? 0,
    },
    funnel,
    pipelineDist,
  };

  return <AnalyticsView data={data} />;
}
