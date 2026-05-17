import { db } from "@/lib/db";
import {
  botDrafts,
  factoryQuoteRequests,
  leadTags,
  leads,
  messages,
} from "@/drizzle/schema";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import type { LeadCardData } from "./_components/LeadsBoard";
import {
  CommandCenter,
  type CommandCenterData,
} from "./_components/CommandCenter";
import { ExpandedLead } from "./_components/ExpandedLead";
import type { ChatMessage } from "./conversations/_components/ChatThread";
import type { OrderSummaryData } from "./conversations/_components/OrderSummary";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 30;

const THREAD_LIMIT = 200;

export default async function V3LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ lead?: string }>;
}) {
  const { lead: leadParam } = await searchParams;
  const selectedSid = leadParam?.trim() || null;

  if (selectedSid) {
    return <ExpandedLeadWrapper sid={selectedSid} />;
  }

  return <CommandCenterWrapper />;
}

async function CommandCenterWrapper() {
  const [{ cards }, pendingDraftRows, factoryReceivedRows] =
    await Promise.all([
      loadLeadCards(),
      db
        .select({
          id: botDrafts.id,
          sid: botDrafts.manychatSubId,
          moneyReason: botDrafts.moneyReason,
          generatedAt: botDrafts.generatedAt,
        })
        .from(botDrafts)
        .where(eq(botDrafts.status, "pending"))
        .orderBy(desc(botDrafts.generatedAt)),
      db
        .select({
          id: factoryQuoteRequests.id,
          sid: factoryQuoteRequests.manychatSubId,
          updatedAt: factoryQuoteRequests.updatedAt,
        })
        .from(factoryQuoteRequests)
        .where(eq(factoryQuoteRequests.factoryStatus, "received"))
        .orderBy(desc(factoryQuoteRequests.updatedAt)),
    ]);
  const [crmTasks, crmSla, latestScores] = await Promise.all([
    loadOpenCrmTasks(),
    loadOpenSlaTimers(),
    loadLatestScoreSnapshots(),
  ]);

  const data: CommandCenterData = {
    cards,
    pendingDrafts: pendingDraftRows.length,
    pendingDraftSids: pendingDraftRows.map((row) => row.sid.trim()),
    factoryReceived: factoryReceivedRows.length,
    factoryReceivedSids: factoryReceivedRows.map((row) => row.sid.trim()),
    crmTasks,
    crmSla,
    latestScores,
  };

  return <CommandCenter data={data} />;
}

async function loadOpenCrmTasks(): Promise<
  Array<{
    id: number;
    sid: string;
    title: string;
    taskType: string;
    dueAt: string | null;
    status: string;
  }>
> {
  try {
    const res = await db.execute(sql`
      SELECT id, manychat_sub_id AS sid, title, task_type AS "taskType",
             due_at AS "dueAt", status
      FROM crm_tasks
      WHERE status = 'open'
      ORDER BY due_at NULLS LAST, created_at DESC
      LIMIT 30
    `);
    const rows = ((res as unknown as { rows?: any[] }).rows ?? []) as any[];
    return rows.map((row) => ({
      id: Number(row.id),
      sid: String(row.sid),
      title: String(row.title),
      taskType: String(row.taskType),
      dueAt: row.dueAt ? new Date(row.dueAt).toISOString() : null,
      status: String(row.status),
    }));
  } catch {
    return [];
  }
}

async function loadOpenSlaTimers(): Promise<
  Array<{ id: number; sid: string; slaType: string; dueAt: string; breached: boolean }>
> {
  try {
    const res = await db.execute(sql`
      SELECT id, manychat_sub_id AS sid, sla_type AS "slaType", due_at AS "dueAt",
             (breached_at IS NOT NULL OR due_at < now()) AS breached
      FROM crm_sla_timers
      WHERE resolved_at IS NULL
      ORDER BY due_at ASC
      LIMIT 30
    `);
    const rows = ((res as unknown as { rows?: any[] }).rows ?? []) as any[];
    return rows.map((row) => ({
      id: Number(row.id),
      sid: String(row.sid),
      slaType: String(row.slaType),
      dueAt: new Date(row.dueAt).toISOString(),
      breached: Boolean(row.breached),
    }));
  } catch {
    return [];
  }
}

async function loadLatestScoreSnapshots(): Promise<
  Array<{ sid: string; scoreTotal: number; scoreBand: string; reason: string | null }>
> {
  try {
    const res = await db.execute(sql`
      SELECT DISTINCT ON (manychat_sub_id)
        manychat_sub_id AS sid,
        score_total AS "scoreTotal",
        score_band AS "scoreBand",
        reason
      FROM lead_score_snapshots
      ORDER BY manychat_sub_id, created_at DESC
      LIMIT 200
    `);
    const rows = ((res as unknown as { rows?: any[] }).rows ?? []) as any[];
    return rows.map((row) => ({
      sid: String(row.sid),
      scoreTotal: Number(row.scoreTotal),
      scoreBand: String(row.scoreBand),
      reason: row.reason ? String(row.reason) : null,
    }));
  } catch {
    return [];
  }
}

async function loadLeadCards(): Promise<{
  cards: LeadCardData[];
  tagsBySid: Map<string, string[]>;
}> {
  const rows = await db
    .select({
      sid: leads.manychatSubId,
      name: leads.name,
      phone: leads.phoneE164,
      jid: leads.waJid,
      source: leads.source,
      leadSource: leads.leadSource,
      stage: leads.pipelineStage,
      flag: leads.pipelineFlag,
      botSummary: leads.botSummary,
      notes: leads.notes,
      quoteTotal: leads.quoteTotal,
      botPaused: leads.botPaused,
      followUpCount: leads.followUpCount,
      updatedAt: leads.updatedAt,
    })
    .from(leads)
    .where(eq(leads.active, true))
    .orderBy(desc(leads.updatedAt));

  const sids = rows.map((r) => r.sid.trim());
  const [tagRows, lastIn] = await Promise.all([
    sids.length === 0
      ? Promise.resolve([])
      : db
          .select({ sid: leadTags.manychatSubId, tag: leadTags.tag })
          .from(leadTags)
          .where(sql`trim(${leadTags.manychatSubId}) IN ${sids}`),
    Promise.all(
      sids.map((sid) =>
        db
          .select({ text: messages.text, receivedAt: messages.receivedAt })
          .from(messages)
          .where(
            and(
              sql`trim(${messages.manychatSubId}) = ${sid}`,
              eq(messages.direction, "in")
            )
          )
          .orderBy(desc(messages.receivedAt))
          .limit(1)
          .then((r) => r[0] ?? null)
      )
    ),
  ]);

  const tagsBySid = new Map<string, string[]>();
  for (const t of tagRows) {
    const key = t.sid.trim();
    const arr = tagsBySid.get(key) ?? [];
    arr.push(t.tag);
    tagsBySid.set(key, arr);
  }

  const cards: LeadCardData[] = rows.map((r, i) => ({
    sid: r.sid,
    name: r.name,
    phone: r.phone,
    jid: r.jid,
    source: r.source,
    leadSource: r.leadSource,
    stage: r.stage ?? "NEW",
    pipelineFlag: r.flag,
    flags: tagsBySid.get(r.sid.trim()) ?? [],
    botSummary: r.botSummary,
    notes: r.notes,
    quoteTotal: r.quoteTotal,
    botPaused: r.botPaused,
    followUpCount: r.followUpCount,
    lastInboundText: lastIn[i]?.text ?? null,
    lastInboundAt: lastIn[i]?.receivedAt?.toISOString() ?? null,
    updatedAt: r.updatedAt.toISOString(),
  }));

  return { cards, tagsBySid };
}

async function ExpandedLeadWrapper({ sid }: { sid: string }) {
  const [leadRow] = await db
    .select({
      sid: leads.manychatSubId,
      name: leads.name,
      phone: leads.phoneE164,
      source: leads.source,
      leadSource: leads.leadSource,
      stage: leads.pipelineStage,
      flag: leads.pipelineFlag,
      botPaused: leads.botPaused,
      botSummary: leads.botSummary,
      notes: leads.notes,
      quoteTotal: leads.quoteTotal,
      quoteAlt: leads.quoteAlt,
      qState: leads.qState,
      factorySpecDraft: leads.factorySpecDraft,
    })
    .from(leads)
    .where(sql`trim(${leads.manychatSubId}) = ${sid}`)
    .limit(1);

  if (!leadRow) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-card/30 p-12 text-center text-sm text-muted-foreground">
        ליד לא נמצא: <code>{sid}</code>
      </div>
    );
  }

  const [tagRows, msgRows] = await Promise.all([
    db
      .select({ tag: leadTags.tag })
      .from(leadTags)
      .where(sql`trim(${leadTags.manychatSubId}) = ${sid}`),
    db
      .select({
        id: messages.id,
        direction: messages.direction,
        sender: messages.sender,
        text: messages.text,
        receivedAt: messages.receivedAt,
      })
      .from(messages)
      .where(sql`trim(${messages.manychatSubId}) = ${sid}`)
      .orderBy(asc(messages.receivedAt))
      .limit(THREAD_LIMIT),
  ]);

  const summary: OrderSummaryData = {
    name: leadRow.name,
    phone: leadRow.phone,
    source: leadRow.source,
    leadSource: leadRow.leadSource,
    stage: leadRow.stage,
    flag: leadRow.flag,
    flags: tagRows.map((t) => t.tag),
    botPaused: leadRow.botPaused,
    botSummary: leadRow.botSummary,
    notes: leadRow.notes,
    quoteTotal: leadRow.quoteTotal,
    quoteAlt: leadRow.quoteAlt,
    qState: (leadRow.qState as Record<string, unknown> | null) ?? null,
    factorySpecDraft:
      (leadRow.factorySpecDraft as Record<string, unknown> | null) ?? null,
  };

  const threadMessages: ChatMessage[] = msgRows.map((m) => ({
    id: m.id,
    direction: m.direction as "in" | "out",
    sender: (m.sender as "lead" | "bot" | "eli" | null) ?? null,
    text: m.text,
    receivedAt: m.receivedAt.toISOString(),
  }));

  return <ExpandedLead sid={sid} summary={summary} messages={threadMessages} />;
}
