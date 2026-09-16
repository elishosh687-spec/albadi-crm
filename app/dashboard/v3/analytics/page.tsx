import { db } from "@/lib/db";
import { botDrafts, botFunnelEvents, leads, messages } from "@/drizzle/schema";
import { and, eq, gte, isNotNull, sql } from "drizzle-orm";
import { AnalyticsView, type AnalyticsData } from "./AnalyticsView";
import {
  lifecycleOf,
  type LifecycleKey,
  type PriorityBand,
} from "../_components/crm-insights";
import { listClosedQuotes } from "@/lib/factory/server/closed";
import { LEAD_QUALITY_LABELS, LOSS_REASON_LABELS } from "@/lib/manychat/stages";
import { loadSalesTargets } from "@/lib/analytics/targets";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 30;

const FUNNEL_ORDER = [
  "INTAKE",
  "DISCAVERY",
  "FACTORY_WAIT",
  "CONSIDERATION",
  "WON",
];

const BOT_FUNNEL_ORDER = [
  ["questionnaire_started", "התחיל שאלון"],
  ["shipping_answered", "ענה על שיטת משלוח"],
  ["quantity_answered", "ענה על כמות"],
  ["size_selected", "בחר מידה"],
  ["colors_answered", "ענה על מספר צבעים"],
  ["spec_confirmed", "אישר מפרט"],
  ["quote_sent", "קיבל מחיר"],
  ["quote_replied", "הגיב אחרי המחיר"],
  ["call_booked", "קבע שיחה"],
  ["deal_closed", "נסגרה עסקה"],
] as const;

export default async function V3AnalyticsPage() {
  const now = new Date();
  const monthAgo = new Date(now.getTime() - 30 * 24 * 3600 * 1000);
  const weekAgo = new Date(now.getTime() - 7 * 24 * 3600 * 1000);
  const staleSince = new Date(now.getTime() - 48 * 3600 * 1000);
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
    needsHuman,
    pausedLeads,
    staleActiveLeads,
    quotedLeads,
    largeQuotedLeads,
    manualReviewLeads,
    qStateRows,
    sourceRows,
    botFunnelRows,
    salesOutcomes,
    dealEconomics,
    salesTargets,
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
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(leads)
      .where(and(eq(leads.active, true), eq(leads.pipelineFlag, "NEEDS_ELI"))),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(leads)
      .where(and(eq(leads.active, true), eq(leads.botPaused, true))),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(leads)
      .where(
        and(
          eq(leads.active, true),
          sql`${leads.pipelineStage} NOT IN ('WON', 'LOST')`,
          sql`${leads.updatedAt} < ${staleSince}`
        )
      ),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(leads)
      .where(and(eq(leads.active, true), isNotNull(leads.quoteTotal))),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(leads)
      .where(
        and(
          eq(leads.active, true),
          isNotNull(leads.quoteTotal),
          sql`cast(nullif(regexp_replace(${leads.quoteTotal}, '[^0-9.]', '', 'g'), '') as numeric) >= 10000`
        )
      ),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(leads)
      .where(
        and(
          eq(leads.active, true),
          eq(leads.pipelineStage, "FACTORY_WAIT"),
          sql`${leads.qState}->>'subFlow' = 'awaiting_factory_estimate'`
        )
      ),
    db
      .select({
        active: sql<number>`count(*) filter (where ${leads.qState} is not null and ${leads.qState}->>'doneAt' is null and coalesce(${leads.qState}->>'bailed', 'false') <> 'true')::int`,
        completed: sql<number>`count(*) filter (where ${leads.qState}->>'doneAt' is not null)::int`,
        bailed: sql<number>`count(*) filter (where coalesce(${leads.qState}->>'bailed', 'false') = 'true')::int`,
      })
      .from(leads)
      .where(eq(leads.active, true)),
    db
      .select({
        source: sql<string>`coalesce(nullif(${leads.leadSource}, ''), nullif(${leads.source}, ''), 'לא ידוע')`,
        leads: sql<number>`count(*)::int`,
        won: sql<number>`count(*) filter (where ${leads.pipelineStage} = 'WON')::int`,
        quoted: sql<number>`count(*) filter (where ${leads.quoteTotal} is not null)::int`,
      })
      .from(leads)
      .where(eq(leads.active, true))
      .groupBy(sql`coalesce(nullif(${leads.leadSource}, ''), nullif(${leads.source}, ''), 'לא ידוע')`)
      .orderBy(sql`count(*) desc`)
      .limit(8),
    db
      .select({
        event: botFunnelEvents.event,
        attempts: sql<number>`count(*)::int`,
        uniqueLeads: sql<number>`count(distinct ${botFunnelEvents.leadSid})::int`,
      })
      .from(botFunnelEvents)
      .groupBy(botFunnelEvents.event),
    loadSalesOutcomeStats(),
    loadDealEconomics(),
    loadSalesTargets(),
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
  const needsHumanCount = needsHuman[0]?.count ?? 0;
  const botFunnelCount = new Map(botFunnelRows.map((row) => [row.event, row]));
  const handoffRate =
    activeLeads.length > 0
      ? Math.round((needsHumanCount / activeLeads.length) * 1000) / 10
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
    operations: {
      needsHuman: needsHumanCount,
      pausedLeads: pausedLeads[0]?.count ?? 0,
      staleActiveLeads: staleActiveLeads[0]?.count ?? 0,
      manualReviewLeads: manualReviewLeads[0]?.count ?? 0,
    },
    revenueOps: {
      quotedLeads: quotedLeads[0]?.count ?? 0,
      largeQuotedLeads: largeQuotedLeads[0]?.count ?? 0,
    },
    botQa: {
      activeQuestionnaires: qStateRows[0]?.active ?? 0,
      completedQuestionnaires: qStateRows[0]?.completed ?? 0,
      bailedQuestionnaires: qStateRows[0]?.bailed ?? 0,
      handoffRatePct: handoffRate,
    },
    botFunnel: BOT_FUNNEL_ORDER.map(([event, label]) => ({
      event,
      label,
      attempts: botFunnelCount.get(event)?.attempts ?? 0,
      uniqueLeads: botFunnelCount.get(event)?.uniqueLeads ?? 0,
    })),
    salesOutcomes: salesOutcomes.outcomes,
    qualification: salesOutcomes.qualification,
    lossReasons: salesOutcomes.lossReasons,
    dealEconomics,
    salesTargets,
    sourcePerformance: sourceRows.map((row) => ({
      source: row.source,
      leads: row.leads,
      won: row.won,
      quoted: row.quoted,
    })),
    lifecycleDist: buildLifecycleDist(activeLeads),
    priorityDist: buildPriorityDist({
      active: activeLeads.length,
      hot: needsHumanCount + pausedLeads[0]?.count + largeQuotedLeads[0]?.count,
      warm: manualReviewLeads[0]?.count + quotedLeads[0]?.count,
      nurture: staleActiveLeads[0]?.count ?? 0,
    }),
    crmOps: await loadCrmOpsStats(),
    funnel,
    pipelineDist,
  };

  return <AnalyticsView data={data} />;
}

async function loadSalesOutcomeStats(): Promise<{
  outcomes: AnalyticsData["salesOutcomes"];
  qualification: AnalyticsData["qualification"];
  lossReasons: AnalyticsData["lossReasons"];
}> {
  const [outcomeResult, qualityResult, lossResult] = await Promise.all([
    db.execute(sql`
      WITH first_quotes AS (
        SELECT trim(lead_sid) sid, min(sent_at) quote_at
        FROM bot_quotes WHERE source = 'initial' GROUP BY 1
      ), replies AS (
        SELECT fq.sid, fq.quote_at, min(m.received_at) reply_at
        FROM first_quotes fq
        JOIN messages m ON trim(m.manychat_sub_id) = fq.sid
          AND (m.sender = 'lead' OR m.direction = 'in')
          AND m.received_at > fq.quote_at
        GROUP BY fq.sid, fq.quote_at
      ), outcomes AS (
        SELECT r.sid, r.quote_at, r.reply_at, l.ghl_contact_id, l.pipeline_stage,
          l.lead_quality, l.meta_qualified_sent_at, l.follow_up_count,
          (SELECT min(m.received_at) FROM messages m
             WHERE trim(m.manychat_sub_id) = r.sid
               AND m.sender = 'eli' AND m.received_at > r.quote_at) human_at,
          EXISTS (
            SELECT 1 FROM call_recording_imports c
            WHERE c.ghl_contact_id = l.ghl_contact_id
              AND c.call_started_at > r.reply_at
              AND coalesce(c.call_duration_sec, 0) >= 30
          ) called,
          EXISTS (
            SELECT 1 FROM factory_quote_requests f
            WHERE trim(f.manychat_sub_id) = r.sid
              AND f.closed_deal_at IS NOT NULL
              AND f.deal_removed_at IS NULL
          ) deal_closed
        FROM replies r JOIN leads l ON trim(l.manychat_sub_id) = r.sid
      )
      SELECT count(*)::int replied,
        count(*) filter (where human_at is not null)::int human_returned,
        count(*) filter (where called)::int called,
        count(*) filter (where lead_quality in ('FIT_READY','FIT_NOT_READY')
          or meta_qualified_sent_at is not null
          or pipeline_stage in ('DISCAVERY','FACTORY_WAIT','CONSIDERATION','WON'))::int qualified,
        count(*) filter (where pipeline_stage = 'WON' or deal_closed)::int closed,
        round(avg(extract(epoch from (human_at - quote_at)) / 60)
          filter (where human_at is not null))::int avg_human_minutes,
        round((percentile_cont(0.5) within group
          (order by extract(epoch from (human_at - quote_at)) / 60)
          filter (where human_at is not null))::numeric)::int median_human_minutes,
        round(avg(follow_up_count)::numeric, 1)::float avg_followups
      FROM outcomes
    `),
    db.execute(sql`
      SELECT coalesce(lead_quality, 'UNCLASSIFIED') key, count(*)::int count
      FROM leads WHERE active = true GROUP BY 1
    `),
    db.execute(sql`
      SELECT coalesce(loss_reason, 'UNRECORDED') key, count(*)::int count
      FROM leads WHERE pipeline_stage = 'LOST' GROUP BY 1
    `),
  ]);
  const rows = (outcomeResult as unknown as { rows?: any[] }).rows ?? [];
  const row = rows[0] ?? {};
  const qualityRows = (qualityResult as unknown as { rows?: any[] }).rows ?? [];
  const lossRows = (lossResult as unknown as { rows?: any[] }).rows ?? [];
  const qualityLabels: Record<string, string> = {
    ...LEAD_QUALITY_LABELS,
    UNCLASSIFIED: "טרם סווג",
  };
  const lossLabels: Record<string, string> = {
    ...LOSS_REASON_LABELS,
    "יקר_לו": "יקר לו",
    "כמות": "כמות גדולה מדי",
    "זמן_אספקה": "זמן אספקה",
    "לא_ענה": "הפסיק לענות",
    "מצא_ספק_אחר": "בחר ספק אחר",
    "לא_רלוונטי": "סיבה אחרת",
    opt_out: "סיבה אחרת",
    UNRECORDED: "לא תועד",
  };
  return {
    outcomes: {
      replied: Number(row.replied ?? 0),
      humanReturned: Number(row.human_returned ?? 0),
      called: Number(row.called ?? 0),
      qualified: Number(row.qualified ?? 0),
      closed: Number(row.closed ?? 0),
      avgHumanResponseMinutes: row.avg_human_minutes == null ? null : Number(row.avg_human_minutes),
      medianHumanResponseMinutes: row.median_human_minutes == null ? null : Number(row.median_human_minutes),
      avgFollowups: row.avg_followups == null ? null : Number(row.avg_followups),
    },
    qualification: qualityRows.map((r) => ({
      key: String(r.key),
      label: qualityLabels[String(r.key)] ?? String(r.key),
      count: Number(r.count ?? 0),
    })),
    lossReasons: lossRows.map((r) => ({
      key: String(r.key),
      label: lossLabels[String(r.key)] ?? String(r.key),
      count: Number(r.count ?? 0),
    })),
  };
}

async function loadDealEconomics(): Promise<AnalyticsData["dealEconomics"]> {
  const deals = await listClosedQuotes();
  const profits = deals
    .map((deal) => {
      const fp = deal.finalPricing;
      if (!fp) return null;
      const actual = deal.actualCosts;
      if (!actual) return Number(fp.totalProfit ?? 0);
      const revenue = Number(actual.actualRevenueIls ?? deal.grandTotalExVat ?? 0);
      const factory = Number(actual.factoryTotalIls ?? fp.totalCost ?? 0);
      const shipping = Number(actual.shippingTotalIls ?? fp.totalShipping ?? 0);
      const commission = Number(actual.commissionIls ?? 0);
      const other = (actual.otherCosts ?? []).reduce(
        (sum, item) => sum + Number(item.amountIls ?? 0),
        0
      );
      return revenue - factory - shipping - commission - other;
    })
    .filter((value): value is number => value !== null && Number.isFinite(value));
  if (profits.length === 0) {
    return { deals: 0, averageProfitIls: null, medianProfitIls: null };
  }
  const sorted = [...profits].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const median = sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
  return {
    deals: profits.length,
    averageProfitIls: profits.reduce((sum, value) => sum + value, 0) / profits.length,
    medianProfitIls: median,
  };
}

async function loadCrmOpsStats(): Promise<AnalyticsData["crmOps"]> {
  try {
    const [tasks, sla, opps, scores] = await Promise.all([
      db.execute(sql`
        SELECT count(*)::int AS count
        FROM crm_tasks
        WHERE status = 'open'
      `),
      db.execute(sql`
        SELECT
          count(*)::int AS open,
          count(*) filter (where breached_at is not null or due_at < now())::int AS breached
        FROM crm_sla_timers
        WHERE resolved_at IS NULL
      `),
      db.execute(sql`
        SELECT count(*)::int AS count
        FROM opportunities
        WHERE pipeline_stage = 'open'
      `),
      db.execute(sql`
        SELECT count(*)::int AS count
        FROM lead_score_snapshots
      `),
    ]);
    const taskRow = (((tasks as unknown as { rows?: any[] }).rows ?? [])[0] ?? {}) as any;
    const slaRow = (((sla as unknown as { rows?: any[] }).rows ?? [])[0] ?? {}) as any;
    const oppRow = (((opps as unknown as { rows?: any[] }).rows ?? [])[0] ?? {}) as any;
    const scoreRow = (((scores as unknown as { rows?: any[] }).rows ?? [])[0] ?? {}) as any;
    return {
      openTasks: Number(taskRow.count ?? 0),
      openSla: Number(slaRow.open ?? 0),
      breachedSla: Number(slaRow.breached ?? 0),
      openOpportunities: Number(oppRow.count ?? 0),
      latestScores: Number(scoreRow.count ?? 0),
    };
  } catch {
    return {
      openTasks: 0,
      openSla: 0,
      breachedSla: 0,
      openOpportunities: 0,
      latestScores: 0,
    };
  }
}

function buildLifecycleDist(
  rows: Array<{ stage: string | null }>
): Array<{ lifecycle: LifecycleKey; count: number }> {
  const counts = new Map<LifecycleKey, number>();
  for (const row of rows) {
    const key = lifecycleOf(row.stage);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const order: LifecycleKey[] = [
    "NEW_INQUIRY",
    "QUALIFIED",
    "SALES_ACCEPTED",
    "OPPORTUNITY",
    "CUSTOMER",
    "CLOSED_LOST",
  ];
  return order.map((lifecycle) => ({
    lifecycle,
    count: counts.get(lifecycle) ?? 0,
  }));
}

function buildPriorityDist({
  active,
  hot,
  warm,
  nurture,
}: {
  active: number;
  hot: number;
  warm: number;
  nurture: number;
}): Array<{ priority: PriorityBand; count: number }> {
  const hotSafe = Math.min(active, Math.max(0, hot));
  const warmSafe = Math.min(active - hotSafe, Math.max(0, warm));
  const nurtureSafe = Math.min(active - hotSafe - warmSafe, Math.max(0, nurture));
  const low = Math.max(0, active - hotSafe - warmSafe - nurtureSafe);
  return [
    { priority: "HOT", count: hotSafe },
    { priority: "WARM", count: warmSafe },
    { priority: "NURTURE", count: nurtureSafe },
    { priority: "LOW", count: low },
  ];
}
