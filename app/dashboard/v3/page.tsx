import { db } from "@/lib/db";
import { leadTags, leads, messages } from "@/drizzle/schema";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { LeadsBoard, type LeadCardData } from "./_components/LeadsBoard";
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

  return <LeadsBoardWrapper />;
}

async function LeadsBoardWrapper() {
  const rows = await db
    .select({
      sid: leads.manychatSubId,
      name: leads.name,
      phone: leads.phoneE164,
      jid: leads.waJid,
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

  return <LeadsBoard cards={cards} />;
}

async function ExpandedLeadWrapper({ sid }: { sid: string }) {
  const [leadRow] = await db
    .select({
      sid: leads.manychatSubId,
      name: leads.name,
      phone: leads.phoneE164,
      stage: leads.pipelineStage,
      flag: leads.pipelineFlag,
      botPaused: leads.botPaused,
      botSummary: leads.botSummary,
      notes: leads.notes,
      quoteTotal: leads.quoteTotal,
      quoteAlt: leads.quoteAlt,
      qState: leads.qState,
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
    stage: leadRow.stage,
    flag: leadRow.flag,
    flags: tagRows.map((t) => t.tag),
    botPaused: leadRow.botPaused,
    botSummary: leadRow.botSummary,
    notes: leadRow.notes,
    quoteTotal: leadRow.quoteTotal,
    quoteAlt: leadRow.quoteAlt,
    qState: (leadRow.qState as Record<string, unknown> | null) ?? null,
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
