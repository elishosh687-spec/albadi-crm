import { db } from "@/lib/db";
import { leadTags, leads, messages } from "@/drizzle/schema";
import { asc, desc, eq, sql } from "drizzle-orm";
import { LeadsView } from "./LeadsView";
import { ExpandedLead } from "../_components/ExpandedLead";
import type { ChatMessage } from "../conversations/_components/ChatThread";
import type { OrderSummaryData } from "../conversations/_components/OrderSummary";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const THREAD_LIMIT = 200;

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ lead?: string }>;
}) {
  const { lead: leadParam } = await searchParams;
  const selectedSid = leadParam?.trim() || null;

  if (selectedSid) {
    return <ExpandedLeadInLeadsContext sid={selectedSid} />;
  }

  return <LeadsListWrapper />;
}

async function LeadsListWrapper() {
  const rows = await db
    .select({
      sid: leads.manychatSubId,
      name: leads.name,
      phone: leads.phoneE164,
      stage: leads.pipelineStage,
      quoteTotal: leads.quoteTotal,
      botSummary: leads.botSummary,
      notes: leads.notes,
      pipelineFlag: leads.pipelineFlag,
      botPaused: leads.botPaused,
      followUpCount: leads.followUpCount,
      updatedAt: leads.updatedAt,
    })
    .from(leads)
    .where(eq(leads.active, true))
    .orderBy(desc(leads.updatedAt));

  return <LeadsView leads={rows} />;
}

/**
 * Loads + renders ExpandedLead for the /leads context. Neighbor list mirrors
 * what LeadsView shows (ALL active leads incl. DROPPED/WON), so prev/next
 * here paginates through the full /leads list rather than the narrower
 * overview list. backHref returns to /dashboard/v3/leads.
 */
async function ExpandedLeadInLeadsContext({ sid }: { sid: string }) {
  const neighborQuery = db
    .select({ sid: leads.manychatSubId })
    .from(leads)
    .where(eq(leads.active, true))
    .orderBy(desc(leads.updatedAt));

  const [leadRow, neighborRows] = await Promise.all([
    db
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
      .limit(1)
      .then((r) => r[0]),
    neighborQuery,
  ]);

  if (!leadRow) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-card/30 p-12 text-center text-sm text-muted-foreground">
        ליד לא נמצא: <code>{sid}</code>
      </div>
    );
  }

  const orderedSids = neighborRows.map((r) => r.sid);
  const idx = orderedSids.findIndex((s) => s.trim() === sid.trim());
  const prevSid = idx > 0 ? orderedSids[idx - 1] : null;
  const nextSid =
    idx >= 0 && idx < orderedSids.length - 1 ? orderedSids[idx + 1] : null;

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

  return (
    <ExpandedLead
      sid={sid}
      summary={summary}
      messages={threadMessages}
      prevSid={prevSid}
      nextSid={nextSid}
      backHref="/dashboard/v3/leads"
    />
  );
}
